"""Integration tests: upload, list, delete, and making sure users can't see each other's files."""

from tests.conftest import upload_text


async def test_upload_txt_becomes_ready(client, user):
    doc = await upload_text(client, user, "notes.txt", "Solar panels last about 25 years.")
    assert doc["status"] == "ready"
    assert doc["num_chunks"] >= 1
    assert doc["filename"] == "notes.txt"
    assert doc["error"] is None


async def test_upload_rejects_unsupported_type(client, user):
    response = await client.post(
        "/api/documents",
        headers=user["headers"],
        files={"file": ("picture.png", b"not really an image", "image/png")},
    )
    assert response.status_code == 415
    assert ".pdf" in response.json()["detail"]


async def test_upload_rejects_empty_file(client, user):
    response = await client.post(
        "/api/documents",
        headers=user["headers"],
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert response.status_code == 400


async def test_upload_requires_login(client):
    response = await client.post(
        "/api/documents", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 401


async def test_list_shows_newest_first(client, user):
    await upload_text(client, user, "first.txt", "The first document.")
    await upload_text(client, user, "second.txt", "The second document.")
    response = await client.get("/api/documents", headers=user["headers"])
    assert response.status_code == 200
    assert [d["filename"] for d in response.json()] == ["second.txt", "first.txt"]


async def test_delete_removes_document(client, user):
    doc = await upload_text(client, user, "temp.txt", "Delete me.")
    response = await client.delete(f"/api/documents/{doc['id']}", headers=user["headers"])
    assert response.status_code == 204
    listing = (await client.get("/api/documents", headers=user["headers"])).json()
    assert listing == []
    gone = await client.get(f"/api/documents/{doc['id']}", headers=user["headers"])
    assert gone.status_code == 404


# ---- User isolation (security) ----


async def test_other_user_cannot_see_my_documents_in_their_list(client, user, other_user):
    await upload_text(client, user, "private.txt", "My private notes.")
    listing = (await client.get("/api/documents", headers=other_user["headers"])).json()
    assert listing == []


async def test_other_user_cannot_open_my_document(client, user, other_user):
    doc = await upload_text(client, user, "private.txt", "My private notes.")
    response = await client.get(f"/api/documents/{doc['id']}", headers=other_user["headers"])
    # 404, not 403: don't even reveal that the document exists.
    assert response.status_code == 404


async def test_other_user_cannot_delete_my_document(client, user, other_user):
    doc = await upload_text(client, user, "private.txt", "My private notes.")
    response = await client.delete(f"/api/documents/{doc['id']}", headers=other_user["headers"])
    assert response.status_code == 404
    # ...and it's still there for the owner.
    still_there = await client.get(f"/api/documents/{doc['id']}", headers=user["headers"])
    assert still_there.status_code == 200
