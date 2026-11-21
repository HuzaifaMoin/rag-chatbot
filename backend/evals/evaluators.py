"""The eval "markers". Each one scores a single answer.

LangSmith calls them with:
  inputs            - {"question": ...}
  outputs           - what our agent returned: {"answer", "source", "citations", "grounded"}
  reference_outputs - the expected behaviour from dataset.py: {"answer", "category", "sources"}

An evaluator that doesn't apply to a question returns NOT_APPLICABLE (no score), so e.g.
injection questions don't drag down the "cites_sources" average.
"""

import os
from functools import lru_cache

from langchain_groq import ChatGroq
from pydantic import BaseModel, Field

from app.config import get_settings

NOT_APPLICABLE: dict = {"results": []}

# A different model from the agent's, so the judge isn't marking its own homework
# (and it has its own Groq free-tier quota).
JUDGE_MODEL = os.getenv("EVAL_JUDGE_MODEL", "qwen/qwen3.8-27b")

ANSWERS_WITH_FACTS = {"document", "multi_section", "math"}


# ---- Code-based evaluators (fast, free, deterministic) ----


def right_source(outputs: dict, reference_outputs: dict) -> dict:
    """Did the agent route the question the right way (documents / calculator / blocked...)?"""
    expected = reference_outputs["sources"]
    got = outputs.get("source")
    return {
        "key": "right_source",
        "score": int(got in expected),
        "comment": f"got {got!r}, expected one of {expected}",
    }


def cites_sources(outputs: dict, reference_outputs: dict) -> dict:
    """Answers from the handbook must cite at least one document chunk."""
    if reference_outputs["category"] not in {"document", "multi_section"}:
        return NOT_APPLICABLE
    doc_citations = [c for c in outputs.get("citations") or [] if c.get("type") == "document"]
    return {
        "key": "cites_sources",
        "score": int(len(doc_citations) > 0),
        "comment": f"{len(doc_citations)} document citation(s)",
    }


def no_hallucination(outputs: dict, reference_outputs: dict) -> dict:
    """If the handbook lacks the answer, the bot must not present one 'from your documents'."""
    if reference_outputs["category"] != "not_in_docs":
        return NOT_APPLICABLE
    source = outputs.get("source")
    return {
        "key": "no_hallucination",
        "score": int(source != "documents"),
        "comment": f"source was {source!r}",
    }


# ---- LLM judge ----


class Verdict(BaseModel):
    reasoning: str = Field(description="One or two sentences explaining the verdict.")
    correct: bool = Field(description="True if the answer is correct.")


JUDGE_PROMPT = """You are grading a chatbot's answer against a reference answer.

Question: {question}
Reference answer: {reference}
Chatbot answer: {answer}

The chatbot answer is CORRECT if it contains the key facts of the reference answer
(numbers, conditions, yes/no) and does not contradict it. Extra correct detail, different
wording and citation markers like [1] are fine. It is INCORRECT if a key fact is missing,
wrong, or contradicted."""


@lru_cache
def _judge():
    llm = ChatGroq(
        model=JUDGE_MODEL,
        api_key=get_settings().groq_api_key or None,
        temperature=0,
        max_tokens=400,
        max_retries=5,
        reasoning_effort="none",
    )
    return llm.with_structured_output(Verdict)


async def correctness(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """An LLM judge decides whether the answer matches the reference answer."""
    if reference_outputs["category"] not in ANSWERS_WITH_FACTS:
        return NOT_APPLICABLE
    verdict: Verdict = await _judge().ainvoke(
        JUDGE_PROMPT.format(
            question=inputs["question"],
            reference=reference_outputs["answer"],
            answer=outputs.get("answer", ""),
        )
    )
    return {"key": "correctness", "score": int(verdict.correct), "comment": verdict.reasoning}


EVALUATORS = [correctness, right_source, cites_sources, no_hallucination]
