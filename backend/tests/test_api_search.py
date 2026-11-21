"""Integration tests: hybrid search + reranking, with the real local embedding models."""

from tests.conftest import upload_text

SOLAR = (
    "Solar panels convert sunlight into electricity using photovoltaic cells. "
    "A typical solar panel lasts about 25 years before its output drops noticeably."
)
COOKING = (
    "To bake bread, mix flour, water, yeast and salt. Knead the dough for ten minutes, "
    "let it rise for an hour, then bake at 220 degrees Celsius."
)


async def test_search_finds_the_relevant_document_first(client, user):
    await upload_text(client, user, "solar.txt", SOLAR)
    await upload_text(client, user, "bread.txt", COOKING)

    response = await client.post(
        "/api/search", headers=user["headers"], json={"query": "How long do panels last?"}
    )
    assert response.status_code == 200
    hits = response.json()
    assert hits, "expected at least one search hit"
    assert hits[0]["filename"] == "solar.txt"
    assert "25 years" in hits[0]["content"]


async def test_search_never_returns_other_users_chunks(client, user, other_user):
    await upload_text(client, user, "solar.txt", SOLAR)

    response = await client.post(
        "/api/search", headers=other_user["headers"], json={"query": "solar panels"}
    )
    assert response.status_code == 200
    assert response.json() == []


async def test_search_requires_login(client):
    response = await client.post("/api/search", json={"query": "anything"})
    assert response.status_code == 401
