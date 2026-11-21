"""Unit tests for two bugs the evals found (Step 4.4):
1. gpt-oss sometimes cites as [1†L1-L9], so correct answers lost their citations.
2. gpt-oss sometimes makes malformed tool calls, which crashed the whole request.
"""

import groq
import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.agent import graph
from app.agent.graph import (
    FALLBACK_ANSWER,
    MalformedToolCallError,
    _invoke_with_tool_retry,
    extract_citation_labels,
    normalize_citations,
)

# ---- 1. Citation formats ----


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("26 days [1†L1-L9].", "26 days [1]."),
        ("See 【1】 and 【2†source】.", "See [1] and [2]."),
        ("From the web [W1†L3].", "From the web [W1]."),
        ("Already clean [1], [2, 3].", "Already clean [1], [2, 3]."),
    ],
)
def test_normalize_citations(raw, expected):
    assert normalize_citations(raw) == expected


def test_suffixed_citation_is_recognised_after_normalising():
    assert extract_citation_labels(normalize_citations("26 days [1†L1-L9].")) == ["1"]


# ---- 2. Malformed tool calls ----


def _groq_error(code: str) -> groq.BadRequestError:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    body = {"error": {"message": "Tool call validation failed", "code": code}}
    return groq.BadRequestError(
        f"Error code: 400 - {body}", response=httpx.Response(400, request=request), body=body
    )


class FakeLLM:
    """Raises the given errors in order, then answers normally."""

    def __init__(self, errors):
        self.errors = list(errors)
        self.calls = 0

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return AIMessage(content="final answer")


async def test_retry_succeeds_after_one_malformed_tool_call():
    llm = FakeLLM([_groq_error("tool_use_failed")])
    result = await _invoke_with_tool_retry(llm, [HumanMessage(content="hi")])
    assert result.content == "final answer"
    assert llm.calls == 2


async def test_gives_up_after_repeated_malformed_tool_calls():
    llm = FakeLLM([_groq_error("tool_use_failed")] * 2)
    with pytest.raises(MalformedToolCallError):
        await _invoke_with_tool_retry(llm, [HumanMessage(content="hi")])


async def test_other_groq_errors_are_not_retried():
    llm = FakeLLM([_groq_error("context_length_exceeded")])
    with pytest.raises(groq.BadRequestError):
        await _invoke_with_tool_retry(llm, [HumanMessage(content="hi")])
    assert llm.calls == 1


async def test_tool_agent_falls_back_instead_of_crashing(monkeypatch):
    broken = FakeLLM([_groq_error("tool_use_failed")] * 10)
    monkeypatch.setattr(graph, "answer_llm", lambda: broken)
    result = await graph.tool_agent({"question": "What is Northwind's revenue?"})
    assert result["answer"] == FALLBACK_ANSWER
    assert result["source"] == "none"
