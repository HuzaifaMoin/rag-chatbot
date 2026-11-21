"""Integration tests: saved chats (conversations + their messages)."""

import uuid

from app.conversations import make_title
from tests.conftest import parse_sse


async def ask(client, user, message, conversation_id=None):
    payload = {"message": message}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    response = await client.post("/api/chat", headers=user["headers"], json=payload)
    assert response.status_code == 200, response.text
    return response.json()


async def test_first_question_creates_a_titled_conversation(client, user, fake_agent):
    answer = await ask(client, user, "How long do solar panels last?")
    chats = (await client.get("/api/conversations", headers=user["headers"])).json()
    assert len(chats) == 1
    assert chats[0]["id"] == answer["conversation_id"]
    assert chats[0]["title"] == "How long do solar panels last?"


async def test_conversation_keeps_messages_with_their_sources(client, user, fake_agent):
    answer = await ask(client, user, "How long do solar panels last?")
    chat = (
        await client.get(f"/api/conversations/{answer['conversation_id']}", headers=user["headers"])
    ).json()
    roles = [m["role"] for m in chat["messages"]]
    assert roles == ["user", "assistant"]
    assert chat["messages"][0]["content"] == "How long do solar panels last?"
    saved = chat["messages"][1]["response"]
    assert saved["citations"][0]["filename"] == "solar.txt"
    assert saved["run_id"] == answer["run_id"]


async def test_follow_ups_use_the_saved_history(client, user, fake_agent):
    first = await ask(client, user, "First question")
    await ask(client, user, "Second question", first["conversation_id"])
    # The backend loaded the history itself (the request didn't send any).
    assert fake_agent[1]["history"] == [
        {"role": "user", "content": "First question"},
        {"role": "assistant", "content": "Solar panels last about 25 years [1]."},
    ]
    chats = (await client.get("/api/conversations", headers=user["headers"])).json()
    assert len(chats) == 1  # still one conversation


async def test_regenerate_replaces_the_last_answer(client, user, fake_agent):
    first = await ask(client, user, "First question")
    await ask(client, user, "Second question", first["conversation_id"])
    response = await client.post(
        "/api/chat",
        headers=user["headers"],
        json={
            "message": "Second question",
            "conversation_id": first["conversation_id"],
            "replace_last": True,
        },
    )
    assert response.status_code == 200
    # The agent saw only the first exchange as history, not the answer being replaced.
    assert len(fake_agent[2]["history"]) == 2
    chat = (
        await client.get(f"/api/conversations/{first['conversation_id']}", headers=user["headers"])
    ).json()
    assert [m["content"] for m in chat["messages"] if m["role"] == "user"] == [
        "First question",
        "Second question",
    ]


async def test_most_recently_used_chat_comes_first(client, user, fake_agent):
    older = await ask(client, user, "Older chat")
    newer = await ask(client, user, "Newer chat")
    await ask(client, user, "Back to the older one", older["conversation_id"])
    chats = (await client.get("/api/conversations", headers=user["headers"])).json()
    assert [c["id"] for c in chats] == [older["conversation_id"], newer["conversation_id"]]


async def test_rename_and_delete(client, user, fake_agent):
    answer = await ask(client, user, "Something")
    url = f"/api/conversations/{answer['conversation_id']}"
    renamed = await client.patch(url, headers=user["headers"], json={"title": "Solar research"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Solar research"

    assert (await client.delete(url, headers=user["headers"])).status_code == 204
    assert (await client.get(url, headers=user["headers"])).status_code == 404
    assert (await client.get("/api/conversations", headers=user["headers"])).json() == []


async def test_streamed_answers_are_saved_with_their_steps(client, user, fake_stream):
    response = await client.post(
        "/api/chat/stream", headers=user["headers"], json={"message": "Streamed question"}
    )
    done = parse_sse(response.text)[-1][1]
    chat = (
        await client.get(f"/api/conversations/{done['conversation_id']}", headers=user["headers"])
    ).json()
    saved = chat["messages"][1]["response"]
    assert saved["steps"][0]["detail"] == "5 passages found"


# ---- User isolation (security) ----


async def test_other_users_cannot_see_open_rename_or_delete_my_chat(
    client, user, other_user, fake_agent
):
    answer = await ask(client, user, "My private chat")
    url = f"/api/conversations/{answer['conversation_id']}"
    other = other_user["headers"]
    assert (await client.get("/api/conversations", headers=other)).json() == []
    assert (await client.get(url, headers=other)).status_code == 404
    assert (await client.patch(url, headers=other, json={"title": "x"})).status_code == 404
    assert (await client.delete(url, headers=other)).status_code == 404


async def test_cannot_continue_someone_elses_chat(client, user, other_user, fake_agent):
    answer = await ask(client, user, "My private chat")
    response = await client.post(
        "/api/chat",
        headers=other_user["headers"],
        json={"message": "Sneaky", "conversation_id": answer["conversation_id"]},
    )
    assert response.status_code == 404
    assert len(fake_agent) == 1  # the agent never ran for the intruder


async def test_unknown_conversation_id(client, user, fake_agent):
    response = await client.post(
        "/api/chat",
        headers=user["headers"],
        json={"message": "Hi", "conversation_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404


def test_titles_are_tidied_and_shortened():
    assert make_title("  How   long\ndo panels last?  ") == "How long do panels last?"
    long_title = make_title("word " * 50)
    assert len(long_title) <= 80
    assert long_title.endswith("…")
