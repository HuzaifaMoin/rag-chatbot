"""'Try the demo' guest accounts: preloaded handbook, question limit, upload limits, expiry."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, update

from app.config import get_settings
from app.db import SessionLocal, engine
from app.demo import delete_expired_guests
from app.main import app
from app.models import Chunk, Document, GuestAccount


@pytest.fixture
def settings(monkeypatch):
    """The real settings object; attributes changed with monkeypatch are reset after the test."""
    s = get_settings()
    monkeypatch.setattr(s, "guests_per_ip_per_hour", 1000)  # tests make many guests
    return s


async def start_demo(client: httpx.AsyncClient) -> dict:
    response = await client.post("/api/auth/guest")
    assert response.status_code == 201, response.text
    return {"headers": {"Authorization": f"Bearer {response.json()['access_token']}"}}


async def test_guest_starts_with_the_handbook_ready(client, settings):
    guest = await start_demo(client)

    me = (await client.get("/api/auth/me", headers=guest["headers"])).json()
    assert me["email"].startswith("guest-")
    assert me["guest"]["questions_left"] == settings.guest_daily_questions
    expires = datetime.fromisoformat(me["guest"]["expires_at"])
    assert timedelta(hours=23) < expires - datetime.now(UTC) <= timedelta(hours=24)

    docs = (await client.get("/api/documents", headers=guest["headers"])).json()
    assert [(d["filename"], d["status"]) for d in docs] == [("northwind_handbook.md", "ready")]
    assert docs[0]["num_chunks"] > 0
    text = await client.get(f"/api/documents/{docs[0]['id']}/chunks", headers=guest["headers"])
    assert "Northwind" in text.json()["chunks"][0]["content"]


async def test_each_guest_gets_their_own_copy(client, settings):
    a = await start_demo(client)
    b = await start_demo(client)
    doc_a = (await client.get("/api/documents", headers=a["headers"])).json()[0]
    doc_b = (await client.get("/api/documents", headers=b["headers"])).json()[0]
    assert doc_a["id"] != doc_b["id"]
    # b can't open a's copy
    response = await client.get(f"/api/documents/{doc_a['id']}", headers=b["headers"])
    assert response.status_code == 404


async def test_normal_users_are_not_guests(client, user, fake_agent):
    me = (await client.get("/api/auth/me", headers=user["headers"])).json()
    assert me["guest"] is None


async def test_guest_question_limit(client, settings, monkeypatch, fake_agent, fake_stream):
    monkeypatch.setattr(settings, "guest_daily_questions", 2)
    guest = await start_demo(client)

    for _ in range(2):
        response = await client.post("/api/chat", headers=guest["headers"], json={"message": "Hi"})
        assert response.status_code == 200, response.text
    me = (await client.get("/api/auth/me", headers=guest["headers"])).json()
    assert me["guest"]["questions_left"] == 0

    response = await client.post("/api/chat", headers=guest["headers"], json={"message": "Hi"})
    assert response.status_code == 429
    assert "demo questions" in response.json()["detail"]
    # The streaming endpoint refuses too, before any event is sent.
    response = await client.post(
        "/api/chat/stream", headers=guest["headers"], json={"message": "Hi"}
    )
    assert response.status_code == 429
    assert len(fake_agent) == 2  # the agent never ran for the refused questions


async def test_guest_upload_limits(client, settings, monkeypatch):
    guest = await start_demo(client)
    file = {"file": ("notes.txt", b"Some notes.", "text/plain")}

    monkeypatch.setattr(settings, "guest_max_upload_mb", 0)  # every file is "too big"
    response = await client.post("/api/documents", headers=guest["headers"], files=file)
    assert response.status_code == 413

    monkeypatch.setattr(settings, "guest_max_upload_mb", 2)
    monkeypatch.setattr(settings, "guest_max_documents", 1)  # the handbook fills it
    response = await client.post("/api/documents", headers=guest["headers"], files=file)
    assert response.status_code == 403
    assert "up to 1 documents" in response.json()["detail"]


async def test_expired_guests_are_deleted_with_their_data(client, settings):
    guest = await start_demo(client)
    me = (await client.get("/api/auth/me", headers=guest["headers"])).json()
    user_id = uuid.UUID(me["id"])

    async with SessionLocal() as session:
        await session.execute(
            update(GuestAccount)
            .where(GuestAccount.user_id == user_id)
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()
        assert await delete_expired_guests(session) >= 1
        for model in (Document, Chunk):
            count = await session.scalar(
                select(func.count()).select_from(model).where(model.owner_id == user_id)
            )
            assert count == 0

    response = await client.get("/api/auth/me", headers=guest["headers"])
    assert response.status_code == 401


async def test_too_many_guests_from_one_address(test_database, settings, monkeypatch):
    monkeypatch.setattr(settings, "guests_per_ip_per_hour", 2)
    # A made-up address of our own, so guests from other tests don't count.
    ip = f"10.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
    transport = httpx.ASGITransport(app=app, client=(ip, 1234))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.post("/api/auth/guest")).status_code == 201
        assert (await client.post("/api/auth/guest")).status_code == 201
        response = await client.post("/api/auth/guest")
        assert response.status_code == 429
    await engine.dispose()
