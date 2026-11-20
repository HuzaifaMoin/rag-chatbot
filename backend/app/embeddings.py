"""Local embedding + reranking models (free, CPU, ONNX via fastembed).

These calls are CPU-bound and synchronous; call them through asyncio.to_thread
from async code so they don't block the event loop.
"""

from functools import lru_cache

from fastembed import TextEmbedding
from fastembed.rerank.cross_encoder import TextCrossEncoder

from app.config import get_settings


@lru_cache
def _embedder() -> TextEmbedding:
    return TextEmbedding(model_name=get_settings().embedding_model)


@lru_cache
def _reranker() -> TextCrossEncoder:
    return TextCrossEncoder(model_name=get_settings().reranker_model)


def embed_documents(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _embedder().passage_embed(texts, batch_size=32)]


def embed_query(text: str) -> list[float]:
    return next(iter(_embedder().query_embed(text))).tolist()


def rerank(query: str, documents: list[str]) -> list[float]:
    """Return one relevance score per document (higher = more relevant)."""
    if not documents:
        return []
    return [float(s) for s in _reranker().rerank(query, documents)]


def warm_up() -> None:
    """Download and load the models once at startup instead of on the first request."""
    embed_query("warm up")
    rerank("warm up", ["warm up"])
