import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, status
from sqlalchemy import select

from app.config import get_settings
from app.demo import check_guest_upload
from app.deps import CurrentUser, SessionDep
from app.ingestion import SUPPORTED_EXTENSIONS, ingest_document
from app.models import Chunk, Document
from app.schemas import ChunkOut, DocumentOut, DocumentText

router = APIRouter(prefix="/api/documents", tags=["documents"])


async def _get_owned(session: SessionDep, user: CurrentUser, document_id: uuid.UUID) -> Document:
    doc = await session.get(Document, document_id)
    # Return 404 (not 403) for other users' documents so ids can't be probed.
    if doc is None or doc.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


@router.post("", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: UploadFile, background: BackgroundTasks, session: SessionDep, user: CurrentUser
) -> Document:
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Supported types: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "File too large")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")
    await check_guest_upload(session, user.id, len(data))  # demo accounts have tighter limits

    doc = Document(owner_id=user.id, filename=filename)
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    background.add_task(ingest_document, doc.id, data, filename)
    return doc


@router.get("", response_model=list[DocumentOut])
async def list_documents(session: SessionDep, user: CurrentUser) -> list[Document]:
    result = await session.scalars(
        select(Document).where(Document.owner_id == user.id).order_by(Document.created_at.desc())
    )
    return list(result)


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(document_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Document:
    return await _get_owned(session, user, document_id)


@router.get("/{document_id}/chunks", response_model=DocumentText)
async def get_document_text(
    document_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> DocumentText:
    """The document's passages in reading order, for the document viewer."""
    doc = await _get_owned(session, user, document_id)
    chunks = await session.scalars(
        select(Chunk).where(Chunk.document_id == doc.id).order_by(Chunk.chunk_index)
    )
    return DocumentText(
        document=DocumentOut.model_validate(doc),
        chunks=[ChunkOut.model_validate(c) for c in chunks],
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    doc = await _get_owned(session, user, document_id)
    await session.delete(doc)
    await session.commit()
