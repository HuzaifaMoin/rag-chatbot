"""Hybrid retrieval: vector search + Postgres full-text search, fused with
Reciprocal Rank Fusion, then reranked by a local cross-encoder."""

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.embeddings import embed_query, rerank
from app.models import Chunk, Document


@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    page: int | None
    content: str
    score: float


def reciprocal_rank_fusion(rankings: Sequence[Sequence[uuid.UUID]], k: int = 60) -> list[uuid.UUID]:
    """Merge ranked id lists. Each item scores sum(1 / (k + rank)) across lists."""
    scores: dict[uuid.UUID, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=scores.__getitem__, reverse=True)


async def hybrid_search(
    session: AsyncSession,
    owner_id: uuid.UUID,
    query: str,
    k: int | None = None,
    document_ids: Sequence[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    s = get_settings()
    k = k or s.retrieval_top_k
    n = s.retrieval_candidates

    filters = [Chunk.owner_id == owner_id]
    if document_ids:
        filters.append(Chunk.document_id.in_(document_ids))

    qvec = await asyncio.to_thread(embed_query, query)
    vector_ids = (
        await session.scalars(
            select(Chunk.id)
            .where(*filters)
            .order_by(Chunk.embedding.cosine_distance(qvec))
            .limit(n)
        )
    ).all()

    tsquery = func.websearch_to_tsquery("english", query)
    keyword_ids = (
        await session.scalars(
            select(Chunk.id)
            .where(*filters, Chunk.content_tsv.op("@@")(tsquery))
            .order_by(func.ts_rank_cd(Chunk.content_tsv, tsquery).desc())
            .limit(n)
        )
    ).all()

    candidate_ids = reciprocal_rank_fusion([vector_ids, keyword_ids])[:n]
    if not candidate_ids:
        return []

    rows = (
        await session.execute(
            select(Chunk, Document.filename)
            .join(Document, Document.id == Chunk.document_id)
            .where(Chunk.id.in_(candidate_ids))
        )
    ).all()

    texts = [chunk.content for chunk, _ in rows]
    scores = await asyncio.to_thread(rerank, query, texts)

    results = [
        RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            filename=filename,
            page=chunk.page,
            content=chunk.content,
            score=score,
        )
        for (chunk, filename), score in zip(rows, scores, strict=True)
    ]
    results.sort(key=lambda r: r.score, reverse=True)
    return results[:k]
