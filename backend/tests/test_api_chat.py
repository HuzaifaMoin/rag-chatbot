"""Integration tests: the /api/chat endpoint, with a FAKE agent.

The real agent calls Groq (slow, rate-limited, different answer each time), so here we
only test the endpoint around it: auth, response shape, and error handling.
The real LLM's answer quality is measured by the evals (Step 4.4), not by these tests.
"""

import uuid

from app.routers import chat as chat_router


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
    # Each saved chat is one LangSmith thread: the thread id is the conversation id.
    assert body["thread_id"] == body["conversation_id"]
    uuid.UUID(body["run_id"])  # a valid id, used later for 👍/👎 feedback
    assert body["latency_ms"] >= 0

    # The endpoint passed the question and history through to the agent.
    assert fake_agent[0]["question"] == "How long do solar panels last?"
    assert len(fake_agent[0]["history"]) == 2


async def test_follow_up_keeps_the_same_conversation_and_thread(client, user, fake_agent):
    first = (
        await client.post("/api/chat", headers=user["headers"], json={"message": "First"})
    ).json()
    second = (
        await client.post(
            "/api/chat",
            headers=user["headers"],
            json={"message": "Follow-up", "conversation_id": first["conversation_id"]},
        )
    ).json()
    assert second["conversation_id"] == first["conversation_id"]
    assert second["thread_id"] == first["thread_id"]


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
