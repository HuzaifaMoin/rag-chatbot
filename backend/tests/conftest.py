"""Shared setup for the integration tests (test_api_*.py).

They call the real API against a real Postgres + pgvector, in a separate
database ("rag_test") so your dev data in "rag" is never touched.
If Postgres isn't running, the integration tests are skipped (unit tests still run).
"""

import asyncio
import os
import uuid

import asyncpg
import pytest

# Must happen BEFORE the app is imported: app/db.py connects using DATABASE_URL at import time.
# Real environment variables win over .env, so this beats the DATABASE_URL in .env.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://rag:rag@localhost:5432/rag_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
# Never send test runs to LangSmith.
os.environ["LANGSMITH_TRACING"] = "false"

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


async def _create_test_database() -> None:
    """Create the rag_test database if it doesn't exist yet."""
    dsn = TEST_DATABASE_URL.replace("+asyncpg", "")
    base_dsn, db_name = dsn.rsplit("/", 1)
    conn = await asyncpg.connect(f"{base_dsn}/postgres", timeout=5)
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", db_name)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()


async def _reset_schema() -> None:
    """Drop and recreate all tables, so every test run starts from a clean database."""
    from app import models  # noqa: F401  (registers the tables on Base.metadata)

    setup_engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with setup_engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await setup_engine.dispose()


@pytest.fixture(scope="session")
def test_database() -> None:
    """Runs once per test session. Skips integration tests if Postgres is unreachable."""
    try:
        asyncio.run(_create_test_database())
    except (OSError, asyncpg.PostgresError, TimeoutError) as e:
        pytest.skip(f"Postgres not reachable ({e}). Start it with: docker compose up -d --wait")
    asyncio.run(_reset_schema())


@pytest.fixture
async def client(test_database):
    """A fake browser that calls the API in memory (no server or port needed)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    # Each test gets its own event loop; close pooled connections tied to this one.
    await engine.dispose()


async def make_user(client: httpx.AsyncClient) -> dict:
    """Sign up a brand-new user (random email) and return their email, password and auth headers."""
    email = f"user-{uuid.uuid4().hex[:12]}@example.com"
    password = "correct-horse-123"
    response = await client.post("/api/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"email": email, "password": password, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture
async def user(client) -> dict:
    return await make_user(client)


@pytest.fixture
async def other_user(client) -> dict:
    return await make_user(client)


async def upload_text(client: httpx.AsyncClient, user: dict, filename: str, content: str) -> dict:
    """Upload a text file and wait until the backend has finished processing it."""
    response = await client.post(
        "/api/documents",
        headers=user["headers"],
        files={"file": (filename, content.encode(), "text/plain")},
    )
    assert response.status_code == 202, response.text
    doc = response.json()
    for _ in range(100):  # up to ~20 seconds
        doc = (await client.get(f"/api/documents/{doc['id']}", headers=user["headers"])).json()
        if doc["status"] != "processing":
            return doc
        await asyncio.sleep(0.2)
    raise AssertionError(f"{filename} was still processing after 20s")
