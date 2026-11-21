"""Streaming chat (POST /api/chat/stream): endpoint tests with a fake agent, plus unit
tests for the pieces that shape the stream (answer text filter, step labels)."""

import pytest

from app.agent.graph import NOT_FOUND, AnswerStreamFilter, step_detail
from app.db import SessionLocal
from app.models import ChatRun
from app.routers import chat as chat_router
from tests.conftest import FINAL_STATE, parse_sse


async def test_stream_sends_steps_tokens_and_done(client, user, fake_stream):
    response = await client.post(
        "/api/chat/stream", headers=user["headers"], json={"message": "Hi"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(response.text)
    assert [name for name, _ in events] == ["step", "step", "token", "reset", "token", "done"]
    assert events[1][1]["detail"] == "5 passages found"
    done = events[-1][1]
    assert done["answer"] == FINAL_STATE["answer"]
    assert done["citations"][0]["filename"] == "solar.txt"
    assert done["run_id"] == str(fake_stream)
    assert done["thread_id"] == done["conversation_id"]


async def test_streamed_answer_can_be_rated(client, user, fake_stream):
    await client.post("/api/chat/stream", headers=user["headers"], json={"message": "Hi"})
    async with SessionLocal() as session:
        run = await session.get(ChatRun, fake_stream)
    assert run is not None  # saved, so POST /api/feedback accepts votes on it


async def test_stream_errors_become_a_clean_error_event(client, user, monkeypatch):
    async def broken_stream_agent(**kwargs):
        yield {"type": "step", "node": "guard_input", "label": "Checking", "status": "running"}
        raise RuntimeError("groq.RateLimitError: secret internal details")

    monkeypatch.setattr(chat_router, "stream_agent", broken_stream_agent)
    response = await client.post(
        "/api/chat/stream", headers=user["headers"], json={"message": "Hi"}
    )
    events = parse_sse(response.text)
    assert events[-1] == (
        "error",
        {"detail": "The language model is unavailable. Try again shortly."},
    )
    assert "secret" not in response.text


async def test_stream_requires_login(client, fake_stream):
    response = await client.post("/api/chat/stream", json={"message": "Hi"})
    assert response.status_code == 401


# ---- Unit tests ----


def test_filter_passes_normal_answers_through():
    f = AnswerStreamFilter()
    assert f.feed("Sol") == "Sol"  # can't be the marker: released straight away
    assert f.feed("ar panels") == "ar panels"


def test_filter_holds_back_the_not_found_marker():
    f = AnswerStreamFilter()
    pieces = [NOT_FOUND[:3], NOT_FOUND[3:8], NOT_FOUND[8:]]
    assert [f.feed(p) for p in pieces] == ["", "", ""]


def test_filter_releases_held_text_once_it_differs_from_the_marker():
    f = AnswerStreamFilter()
    assert f.feed("NOT") == ""  # could be the marker...
    assert f.feed(" really") == "NOT really"  # ...but isn't: everything comes out


@pytest.mark.parametrize(
    ("node", "result", "expected"),
    [
        ("retrieve", {"candidates": [1, 2, 3, 4, 5]}, "5 passages found"),
        ("retrieve", {"candidates": [1]}, "1 passage found"),
        ("grade", {"context": []}, "None relevant"),
        ("generate", {"answer": NOT_FOUND}, "Not covered by your documents"),
        ("check_grounding", {"grounded": False}, "Not fully supported, rewriting"),
        ("tool_agent", {"tools_used": ["web_search", "web_search"]}, "Used web search"),
        ("guard_input", {"source": "blocked"}, "Blocked: looks like a prompt-injection attempt"),
        ("finalize", {}, None),
    ],
)
def test_step_details(node, result, expected):
    assert step_detail(node, result) == expected
