"""Integration tests: 👍/👎 feedback on chat answers."""

import uuid

import pytest

from app.db import SessionLocal
from app.models import ChatRun
from app.routers import feedback as feedback_router


@pytest.fixture
def langsmith_calls(monkeypatch):
    """Replace the LangSmith upload with a fake that records what it would have sent."""
    calls = []

    def fake_send(run_id, score, first_vote, comment=None):
        call = {"run_id": run_id, "score": score, "first_vote": first_vote}
        if comment:
            call["comment"] = comment
        calls.append(call)

    monkeypatch.setattr(feedback_router, "send_to_langsmith", fake_send)
    return calls


async def ask(client, user) -> str:
    """Ask a question (with the fake agent) and return the answer's run_id."""
    response = await client.post("/api/chat", headers=user["headers"], json={"message": "Hi"})
    assert response.status_code == 200
    return response.json()["run_id"]


async def saved_score(run_id: str) -> int | None:
    async with SessionLocal() as session:
        run = await session.get(ChatRun, uuid.UUID(run_id))
        return run.score


async def test_thumbs_up_on_my_answer(client, user, fake_agent, langsmith_calls):
    run_id = await ask(client, user)
    response = await client.post(
        "/api/feedback", headers=user["headers"], json={"run_id": run_id, "score": 1}
    )
    assert response.status_code == 204
    assert await saved_score(run_id) == 1
    assert langsmith_calls == [{"run_id": uuid.UUID(run_id), "score": 1, "first_vote": True}]


async def test_changing_my_vote_updates_instead_of_duplicating(
    client, user, fake_agent, langsmith_calls
):
    run_id = await ask(client, user)
    for score in (1, 0):
        response = await client.post(
            "/api/feedback", headers=user["headers"], json={"run_id": run_id, "score": score}
        )
        assert response.status_code == 204
    assert await saved_score(run_id) == 0
    # First vote creates the LangSmith feedback, the second only updates it.
    assert [c["first_vote"] for c in langsmith_calls] == [True, False]


async def test_thumbs_down_with_a_reason(client, user, fake_agent, langsmith_calls):
    run_id = await ask(client, user)
    await client.post("/api/feedback", headers=user["headers"], json={"run_id": run_id, "score": 0})
    response = await client.post(
        "/api/feedback",
        headers=user["headers"],
        json={"run_id": run_id, "score": 0, "comment": "  Cited the wrong section  "},
    )
    assert response.status_code == 204
    assert langsmith_calls[-1] == {
        "run_id": uuid.UUID(run_id),
        "score": 0,
        "first_vote": False,
        "comment": "Cited the wrong section",
    }


async def test_comment_length_is_limited(client, user, fake_agent, langsmith_calls):
    run_id = await ask(client, user)
    response = await client.post(
        "/api/feedback",
        headers=user["headers"],
        json={"run_id": run_id, "score": 0, "comment": "x" * 1001},
    )
    assert response.status_code == 422


async def test_cannot_rate_someone_elses_answer(
    client, user, other_user, fake_agent, langsmith_calls
):
    run_id = await ask(client, user)
    response = await client.post(
        "/api/feedback", headers=other_user["headers"], json={"run_id": run_id, "score": 0}
    )
    assert response.status_code == 404
    assert await saved_score(run_id) is None  # untouched
    assert langsmith_calls == []


async def test_unknown_run_id(client, user, langsmith_calls):
    response = await client.post(
        "/api/feedback", headers=user["headers"], json={"run_id": str(uuid.uuid4()), "score": 1}
    )
    assert response.status_code == 404


async def test_score_must_be_0_or_1(client, user, fake_agent, langsmith_calls):
    run_id = await ask(client, user)
    response = await client.post(
        "/api/feedback", headers=user["headers"], json={"run_id": run_id, "score": 5}
    )
    assert response.status_code == 422


async def test_feedback_requires_login(client, langsmith_calls):
    response = await client.post("/api/feedback", json={"run_id": str(uuid.uuid4()), "score": 1})
    assert response.status_code == 401


def test_feedback_id_is_stable_per_run():
    run_id = uuid.uuid4()
    assert feedback_router.feedback_id_for(run_id) == feedback_router.feedback_id_for(run_id)
    assert feedback_router.feedback_id_for(run_id) != feedback_router.feedback_id_for(uuid.uuid4())
