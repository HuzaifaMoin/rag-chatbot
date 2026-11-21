"""Saved chats: shared helpers for the chat endpoints and the /api/conversations router."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatMessage, Conversation

MAX_HISTORY_MESSAGES = 40  # 20 question/answer pairs, same limit as the request body allows
TITLE_LENGTH = 80


def make_title(question: str) -> str:
    """'How many days of leave do I get?' -> the chat's title (shortened if long)."""
    text = " ".join(question.split())
    return text if len(text) <= TITLE_LENGTH else text[: TITLE_LENGTH - 1].rstrip() + "…"


async def get_owned_conversation(
    session: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    # 404 (not 403) for other users' chats, so ids can't be probed.
    if conversation is None or conversation.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conversation


async def load_history(session: AsyncSession, conversation_id: uuid.UUID) -> list[dict[str, str]]:
    """The latest messages of a chat, oldest first, as the agent expects them."""
    rows = await session.scalars(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(MAX_HISTORY_MESSAGES)
    )
    return [{"role": m.role, "content": m.content} for m in reversed(list(rows))]


async def drop_last_exchange(session: AsyncSession, conversation_id: uuid.UUID) -> None:
    """Remove the last question and its answer (used by Regenerate)."""
    rows = await session.scalars(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(2)
    )
    last_two = list(rows)
    if [m.role for m in last_two] == ["assistant", "user"]:
        await session.execute(
            delete(ChatMessage).where(ChatMessage.id.in_([m.id for m in last_two]))
        )
        await session.commit()


async def save_exchange(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    is_new: bool,
    question: str,
    answer: str,
    response: dict,
) -> None:
    """Store a question and its answer (creating the conversation on its first question)."""
    if is_new:
        session.add(Conversation(id=conversation_id, owner_id=user_id, title=make_title(question)))
    else:
        conversation = await session.get(Conversation, conversation_id)
        if conversation is not None:
            conversation.updated_at = func.now()  # moves it to the top of the chats list
    session.add(ChatMessage(conversation_id=conversation_id, role="user", content=question))
    session.add(
        ChatMessage(
            conversation_id=conversation_id, role="assistant", content=answer, response=response
        )
    )
