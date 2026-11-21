"""Integration tests: the /api/chat endpoint, with a FAKE agent.

The real agent calls Groq (slow, rate-limited, different answer each time), so here we
only test the endpoint around it: auth, response shape, and error handling.
The real LLM's answer quality is measured by the evals (Step 4.4), not by these tests.
"""

import uuid

import pytest

from app.routers import chat as chat_router


@pytest.fixture
def fake_agent(monkeypatch):
    """Replace the real agent with one that returns a fixed answer and records what it got."""
    calls = []

    async def fake_run_agent(*, question, owner_id, history, document_ids, thread_id):
        calls.append({"question": question, "owner_id": owner_id, "history": history})
        state = {
            "answer": "Solar panels last about 25 years [1].",
            "source": "documents",
            "citations": [
                {
                    "label": "1",
                    "type": "document",
                    "snippet": "A typical solar panel lasts about 25 years.",
                    "filename": "solar.txt",
                    "page": None,
                }
            ],
            "grounded": True,
            "tools_used": [],
            "search_query": "solar panel lifespan",
        }
        return state, uuid.uuid4(), thread_id or "new-thread-id"

    monkeypatch.setattr(chat_router, "run_agent", fake_run_agent)
    return calls


async def test_chat_returns_answer_with_citations(client, user, fake_agent):
    response = await client.post(
        "/api/chat",
        headers=user["headers"],
        json={
            "message": "How long do solar panels last?",
            "history": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello!"},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Solar panels last about 25 years [1]."
    assert body["source"] == "documents"
    assert body["citations"][0]["filename"] == "solar.txt"
    assert body["grounded"] is True
    assert body["thread_id"] == "new-thread-id"
    uuid.UUID(body["run_id"])  # a valid id, used later for 👍/👎 feedback
    assert body["latency_ms"] >= 0

    # The endpoint passed the question and history through to the agent.
    assert fake_agent[0]["question"] == "How long do solar panels last?"
    assert len(fake_agent[0]["history"]) == 2


async def test_chat_keeps_the_thread_id(client, user, fake_agent):
    response = await client.post(
        "/api/chat",
        headers=user["headers"],
        json={"message": "Follow-up question", "thread_id": "my-thread"},
    )
    assert response.json()["thread_id"] == "my-thread"


async def test_chat_hides_internal_errors(client, user, monkeypatch):
    async def broken_agent(**kwargs):
        raise RuntimeError("groq.RateLimitError: secret internal details")

    monkeypatch.setattr(chat_router, "run_agent", broken_agent)
    response = await client.post("/api/chat", headers=user["headers"], json={"message": "Hello"})
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail == "The language model is unavailable. Try again shortly."
    assert "secret" not in detail


async def test_chat_rejects_empty_message(client, user, fake_agent):
    response = await client.post("/api/chat", headers=user["headers"], json={"message": ""})
    assert response.status_code == 422


async def test_chat_requires_login(client, fake_agent):
    response = await client.post("/api/chat", json={"message": "Hello"})
    assert response.status_code == 401
    assert fake_agent == []  # the agent never ran
