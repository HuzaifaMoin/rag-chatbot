import json
import logging
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.agent.graph import run_agent, stream_agent
from app.db import SessionLocal
from app.deps import CurrentUser, SessionDep
from app.models import ChatRun
from app.schemas import ChatRequest, ChatResponse, Citation

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

LLM_UNAVAILABLE = "The language model is unavailable. Try again shortly."


def to_response(state: dict, run_id: uuid.UUID, thread_id: str, started: float) -> ChatResponse:
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
    )


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, user: CurrentUser, session: SessionDep) -> ChatResponse:
    """Ask a question. Answers come from your documents (with citations); if they
    don't cover it, the agent falls back to web search / calculator and says so."""
    started = time.perf_counter()
    try:
        state, run_id, thread_id = await run_agent(
            question=body.message,
            owner_id=user.id,
            history=[t.model_dump() for t in body.history],
            document_ids=body.document_ids,
            thread_id=body.thread_id,
        )
    except Exception as e:
        # Most likely the LLM provider (rate limit / outage). Don't leak internals.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, LLM_UNAVAILABLE) from e

    # Remember who asked, so only this user can rate the answer (POST /api/feedback).
    session.add(ChatRun(id=run_id, owner_id=user.id))
    await session.commit()
    return to_response(state, run_id, thread_id, started)


def sse(event: str, data: dict) -> str:
    """One Server-Sent Event: 'event: <name>' + 'data: <json>' + a blank line."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/stream")
async def chat_stream(body: ChatRequest, user: CurrentUser) -> StreamingResponse:
    """Same as POST /api/chat, but streamed as Server-Sent Events while the agent works:
    step (a step started/finished), token (answer text), reset (draft thrown away),
    done (the full ChatResponse), error."""
    user_id = user.id  # read now: the request's DB session is gone once streaming starts

    async def events() -> AsyncIterator[str]:
        started = time.perf_counter()
        try:
            async for event in stream_agent(
                question=body.message,
                owner_id=user_id,
                history=[t.model_dump() for t in body.history],
                document_ids=body.document_ids,
                thread_id=body.thread_id,
            ):
                kind = event.pop("type")
                if kind != "final":
                    yield sse(kind, event)
                    continue
                async with SessionLocal() as session:
                    session.add(ChatRun(id=event["run_id"], owner_id=user_id))
                    await session.commit()
                response = to_response(event["state"], event["run_id"], event["thread_id"], started)
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
