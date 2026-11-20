"""LLM clients. All Groq free tier; cached so connections are reused."""

from functools import lru_cache

from langchain_groq import ChatGroq

from app.config import get_settings


def _groq(model: str, **kwargs) -> ChatGroq:
    s = get_settings()
    return ChatGroq(model=model, api_key=s.groq_api_key or None, max_retries=2, **kwargs)


@lru_cache
def fast_llm() -> ChatGroq:
    """Query rewriting, relevance grading, grounding checks."""
    return _groq(get_settings().fast_model, temperature=0, reasoning_effort="low", max_tokens=600)


@lru_cache
def answer_llm() -> ChatGroq:
    """Final answers and tool use."""
    return _groq(
        get_settings().answer_model, temperature=0.2, reasoning_effort="low", max_tokens=1500
    )


@lru_cache
def guard_llm() -> ChatGroq:
    """Llama Prompt Guard 2: returns the probability that the input is an attack."""
    return _groq(get_settings().guard_model, temperature=0, max_tokens=10)
