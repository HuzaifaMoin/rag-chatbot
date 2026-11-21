import json
import logging
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.agent.graph import run_agent, stream_agent
from app.conversations import (
    drop_last_exchange,
    get_owned_conversation,
    load_history,
    save_exchange,
)
from app.db import SessionLocal
from app.deps import CurrentUser, SessionDep
from app.models import ChatRun
from app.schemas import ChatRequest, ChatResponse, Citation

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

LLM_UNAVAILABLE = "The language model is unavailable. Try again shortly."


async def prepare_conversation(
    session, user_id: uuid.UUID, body: ChatRequest
) -> tuple[uuid.UUID, bool, list[dict[str, str]]]:
    """-> (conversation id, is it new?, history). Continuing a chat loads its saved history;
    a new chat gets a fresh id and uses whatever history the request sent (usually none)."""
    if body.conversation_id:
        await get_owned_conversation(session, user_id, body.conversation_id)  # 404 if not yours
        if body.replace_last:
            await drop_last_exchange(session, body.conversation_id)
        return body.conversation_id, False, await load_history(session, body.conversation_id)
    return uuid.uuid4(), True, [t.model_dump() for t in body.history]


def to_response(
    state: dict,
    run_id: uuid.UUID,
    thread_id: str,
    started: float,
    conversation_id: uuid.UUID | None = None,
) -> ChatResponse:
    """The agent's final state -> what the frontend gets (same for normal and streamed chat)."""
    return ChatResponse(
        answer=state["answer"],
        source=state["source"],
        citations=[Citation(**c) for c in state.get("citations") or []],
        grounded=state.get("grounded"),
        tools_used=state.get("tools_used") or [],
        search_query=state.get("search_query"),
        thread_id=thread_id,
        run_id=run_id,
        latency_ms=int((time.perf_counter() - started) * 1000),
        conversation_id=conversation_id,
    )


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, user: CurrentUser, session: SessionDep) -> ChatResponse:
    """Ask a question. Answers come from your documents (with citations); if they
    don't cover it, the agent falls back to web search / calculator and says so."""
    started = time.perf_counter()
    conversation_id, is_new, history = await prepare_conversation(session, user.id, body)
    try:
        state, run_id, thread_id = await run_agent(
            question=body.message,
            owner_id=user.id,
            history=history,
            document_ids=body.document_ids,
            thread_id=str(conversation_id),  # one LangSmith thread per saved chat
        )
    except Exception as e:
        # Most likely the LLM provider (rate limit / outage). Don't leak internals.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, LLM_UNAVAILABLE) from e

    response = to_response(state, run_id, thread_id, started, conversation_id)
    # Remember who asked (so only they can rate it) and save the exchange to the chat.
    session.add(ChatRun(id=run_id, owner_id=user.id))
    await save_exchange(
        session,
        user_id=user.id,
        conversation_id=conversation_id,
        is_new=is_new,
        question=body.message,
        answer=response.answer,
        response=response.model_dump(mode="json"),
    )
    await session.commit()
    return response


def sse(event: str, data: dict) -> str:
    """One Server-Sent Event: 'event: <name>' + 'data: <json>' + a blank line."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/stream")
async def chat_stream(
    body: ChatRequest, user: CurrentUser, session: SessionDep
) -> StreamingResponse:
    """Same as POST /api/chat, but streamed as Server-Sent Events while the agent works:
    step (a step started/finished), token (answer text), reset (draft thrown away),
    done (the full ChatResponse), error."""
    user_id = user.id  # read now: the request's DB session is gone once streaming starts
    # Before streaming starts, so a wrong conversation id is a normal 404.
    conversation_id, is_new, history = await prepare_conversation(session, user_id, body)

    async def events() -> AsyncIterator[str]:
        started = time.perf_counter()
        steps: list[dict] = []  # finished steps, saved with the answer
        try:
            async for event in stream_agent(
                question=body.message,
                owner_id=user_id,
                history=history,
                document_ids=body.document_ids,
                thread_id=str(conversation_id),
            ):
                kind = event.pop("type")
                if kind == "step" and event.get("status") == "done":
                    steps.append(event)
                if kind != "final":
                    yield sse(kind, event)
                    continue
                response = to_response(
                    event["state"], event["run_id"], event["thread_id"], started, conversation_id
                )
                saved = {**response.model_dump(mode="json"), "steps": steps}
                async with SessionLocal() as db:
                    db.add(ChatRun(id=event["run_id"], owner_id=user_id))
                    await save_exchange(
                        db,
                        user_id=user_id,
                        conversation_id=conversation_id,
                        is_new=is_new,
                        question=body.message,
                        answer=response.answer,
                        response=saved,
                    )
                    await db.commit()
                yield sse("done", response.model_dump(mode="json"))
        except Exception:
            logger.exception("streamed chat failed")
            yield sse("error", {"detail": LLM_UNAVAILABLE})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # Don't let proxies hold the events back in a buffer.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
