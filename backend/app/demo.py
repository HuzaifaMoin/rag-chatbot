"""The "Try the demo" feature: throwaway guest accounts with the Northwind handbook preloaded.

Each visitor who clicks "Try the demo" gets their own fresh account, so guests never see
each other's chats. A guest account:
  - starts with one ready document (the fictional Northwind Robotics handbook),
  - can ask `guest_daily_questions` questions per 24 hours (checked here, in the backend),
  - is deleted, with everything in it, after `guest_ttl_hours`.
"""

import asyncio
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionLocal
from app.embeddings import embed_documents
from app.ingestion import chunk_pages, extract_pages
from app.models import ChatRun, Chunk, Document, DocumentStatus, GuestAccount, User
from app.schemas import GuestInfo
from app.security import hash_password

log = logging.getLogger(__name__)

HANDBOOK_PATH = Path(__file__).parent / "demo_data" / "northwind_handbook.md"

# The handbook's chunks and their vectors, worked out once and then copied into every
# new guest account. Embedding is the slow part, so it shouldn't happen per visitor.
_handbook: list[tuple[int | None, str, list[float]]] | None = None
_handbook_lock = asyncio.Lock()


async def handbook_chunks() -> list[tuple[int | None, str, list[float]]]:
    """-> [(page, text, vector), ...] for the handbook, computed on first use."""
    global _handbook
    async with _handbook_lock:  # two first visitors at once shouldn't both embed it
        if _handbook is None:
            data = HANDBOOK_PATH.read_bytes()
            chunks = chunk_pages(extract_pages(data, HANDBOOK_PATH.name))
            vectors = await asyncio.to_thread(embed_documents, [c.content for c in chunks])
            _handbook = [(c.page, c.content, v) for c, v in zip(chunks, vectors, strict=True)]
    return _handbook


async def create_guest(session: AsyncSession, ip: str) -> User:
    """Make a new guest user with the handbook already uploaded and ready."""
    s = get_settings()
    since = datetime.now(UTC) - timedelta(hours=1)
    recent = await session.scalar(
        select(func.count())
        .select_from(GuestAccount)
        .where(GuestAccount.ip == ip, GuestAccount.created_at > since)
    )
    if recent >= s.guests_per_ip_per_hour:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many demo accounts from your network. Please try again in an hour.",
        )

    chunks = await handbook_chunks()
    user = User(
        email=f"guest-{secrets.token_hex(6)}@guest.example",
        # A random password nobody knows: guests come back with their token, not a login.
        password_hash=hash_password(secrets.token_urlsafe(24)),
    )
    session.add(user)
    await session.flush()  # gives the user its id
    session.add(
        GuestAccount(
            user_id=user.id,
            ip=ip,
            expires_at=datetime.now(UTC) + timedelta(hours=s.guest_ttl_hours),
        )
    )
    doc = Document(
        owner_id=user.id,
        filename=HANDBOOK_PATH.name,
        status=DocumentStatus.ready,
        num_chunks=len(chunks),
    )
    session.add(doc)
    await session.flush()
    session.add_all(
        Chunk(
            document_id=doc.id,
            owner_id=user.id,
            chunk_index=i,
            page=page,
            content=text,
            embedding=vector,
        )
        for i, (page, text, vector) in enumerate(chunks)
    )
    await session.commit()
    return user


async def delete_expired_guests(session: AsyncSession) -> int:
    """Delete guests whose time is up. The database's ON DELETE CASCADE removes their
    documents, chunks, chats and ratings too. Returns how many were deleted."""
    expired = select(GuestAccount.user_id).where(GuestAccount.expires_at < datetime.now(UTC))
    result = await session.execute(delete(User).where(User.id.in_(expired)))
    await session.commit()
    return result.rowcount or 0


async def cleanup_loop(every_minutes: int = 30) -> None:
    """Runs for as long as the server does (started in main.py's lifespan)."""
    while True:
        try:
            async with SessionLocal() as session:
                if n := await delete_expired_guests(session):
                    log.info("Deleted %d expired demo account(s)", n)
        except Exception:
            log.exception("Demo account cleanup failed")  # try again next round
        await asyncio.sleep(every_minutes * 60)


async def guest_info(session: AsyncSession, user_id: uuid.UUID) -> GuestInfo | None:
    """None for normal users; otherwise the guest's expiry time and questions left."""
    guest = await session.get(GuestAccount, user_id)
    if guest is None:
        return None
    limit = get_settings().guest_daily_questions
    since = datetime.now(UTC) - timedelta(hours=24)
    # Every answered question saves a ChatRun row, so counting them counts questions.
    used = await session.scalar(
        select(func.count())
        .select_from(ChatRun)
        .where(ChatRun.owner_id == user_id, ChatRun.created_at > since)
    )
    return GuestInfo(
        expires_at=guest.expires_at, questions_left=max(limit - used, 0), question_limit=limit
    )


async def check_question_quota(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Called before answering. Raises 429 when a guest has used all their questions."""
    info = await guest_info(session, user_id)
    if info is not None and info.questions_left <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"You've used all {info.question_limit} demo questions for today. "
            "Create a free account to keep chatting with your own documents.",
        )


async def check_guest_upload(session: AsyncSession, user_id: uuid.UUID, size: int) -> None:
    """Guests can add a few small files of their own, but not fill the free database."""
    if await session.get(GuestAccount, user_id) is None:
        return
    s = get_settings()
    if size > s.guest_max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Demo accounts can upload files up to {s.guest_max_upload_mb} MB.",
        )
    count = await session.scalar(
        select(func.count()).select_from(Document).where(Document.owner_id == user_id)
    )
    if count >= s.guest_max_documents:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Demo accounts can hold up to {s.guest_max_documents} documents. "
            "Delete one, or create a free account.",
        )
