"""Local embedding + reranking models (free, CPU, ONNX via fastembed).

These calls are CPU-bound and synchronous; call them through asyncio.to_thread
from async code so they don't block the event loop.
"""

from functools import lru_cache

from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource
from fastembed.rerank.cross_encoder import TextCrossEncoder

from app.config import get_settings

# The same MiniLM reranker, but its 8-bit "quantized" file: numbers stored as small
# integers instead of 32-bit floats. ~4x smaller in memory (63 MB vs 157 MB) and it
# ranked our handbook passages in exactly the same order. fastembed only knows the
# full-size file, so we register this one under our own name.
QUANTIZED_RERANKER = "rag/ms-marco-MiniLM-L-6-v2-q8"
if QUANTIZED_RERANKER.lower() not in {
    m["model"].lower() for m in TextCrossEncoder.list_supported_models()
}:
    TextCrossEncoder.add_custom_model(
        QUANTIZED_RERANKER,
        sources=ModelSource(hf="Xenova/ms-marco-MiniLM-L-6-v2"),
        model_file="onnx/model_quantized.onnx",
        license="apache-2.0",
        size_in_gb=0.02,
    )


@lru_cache
def _embedder() -> TextEmbedding:
    s = get_settings()
    return TextEmbedding(model_name=s.embedding_model, enable_cpu_mem_arena=s.onnx_mem_arena)


@lru_cache
def _reranker() -> TextCrossEncoder:
    s = get_settings()
    return TextCrossEncoder(model_name=s.reranker_model, enable_cpu_mem_arena=s.onnx_mem_arena)


def embed_documents(texts: list[str]) -> list[list[float]]:
    batch_size = get_settings().embed_batch_size
    return [v.tolist() for v in _embedder().passage_embed(texts, batch_size=batch_size)]


def embed_query(text: str) -> list[float]:
    return next(iter(_embedder().query_embed(text))).tolist()


def rerank(query: str, documents: list[str]) -> list[float]:
    """Return one relevance score per document (higher = more relevant)."""
    if not documents:
        return []
    batch_size = get_settings().rerank_batch_size
    return [float(s) for s in _reranker().rerank(query, documents, batch_size=batch_size)]


def warm_up() -> None:
    """Download and load the models once at startup instead of on the first request."""
    embed_query("warm up")
    rerank("warm up", ["warm up"])
