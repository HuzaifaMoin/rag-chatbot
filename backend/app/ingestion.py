import asyncio
import io
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

import docx
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from app.config import get_settings
from app.db import SessionLocal
from app.embeddings import embed_documents
from app.models import Chunk, Document, DocumentStatus

log = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}


class UnsupportedFileType(ValueError):
    pass


@dataclass
class TextChunk:
    content: str
    page: int | None


def _clean(text: str) -> str:
    # Postgres TEXT cannot store NUL bytes, which some PDFs emit.
    return text.replace("\x00", "").strip()


def extract_pages(data: bytes, filename: str) -> list[tuple[int | None, str]]:
    """Return (page_number, text) pairs. Page is None for formats without pages."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return [(i + 1, _clean(p.extract_text() or "")) for i, p in enumerate(reader.pages)]
    if ext == ".docx":
        d = docx.Document(io.BytesIO(data))
        return [(None, _clean("\n".join(p.text for p in d.paragraphs)))]
    if ext in {".txt", ".md"}:
        return [(None, _clean(data.decode("utf-8", errors="replace")))]
    raise UnsupportedFileType(f"Unsupported file type: {ext or 'none'}")


def chunk_pages(pages: list[tuple[int | None, str]]) -> list[TextChunk]:
    s = get_settings()
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=s.chunk_size, chunk_overlap=s.chunk_overlap
    )
    chunks: list[TextChunk] = []
    for page, text in pages:
        if not text:
            continue
        chunks.extend(TextChunk(content=c, page=page) for c in splitter.split_text(text))
    return chunks


async def ingest_document(document_id: uuid.UUID, data: bytes, filename: str) -> None:
    """Background task: extract -> chunk -> embed -> store. Sets the document status."""
    async with SessionLocal() as session:
        doc = await session.get(Document, document_id)
        if doc is None:
            return
        try:
            pages = await asyncio.to_thread(extract_pages, data, filename)
            chunks = chunk_pages(pages)
            if not chunks:
                raise ValueError("No extractable text found (is it a scanned PDF?)")
            vectors = await asyncio.to_thread(embed_documents, [c.content for c in chunks])
            session.add_all(
                Chunk(
                    document_id=doc.id,
                    owner_id=doc.owner_id,
                    chunk_index=i,
                    page=c.page,
                    content=c.content,
                    embedding=v,
                )
                for i, (c, v) in enumerate(zip(chunks, vectors, strict=True))
            )
            doc.status = DocumentStatus.ready
            doc.num_chunks = len(chunks)
            await session.commit()
            log.info("Ingested %s (%d chunks)", filename, len(chunks))
        except Exception as e:
            log.exception("Ingestion failed for %s", filename)
            await session.rollback()
            doc = await session.get(Document, document_id)
            if doc is not None:
                doc.status = DocumentStatus.failed
                doc.error = str(e)[:1000]
                await session.commit()
