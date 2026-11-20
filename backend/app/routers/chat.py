import time

from fastapi import APIRouter, HTTPException, status

from app.agent.graph import run_agent
from app.deps import CurrentUser
from app.schemas import ChatRequest, ChatResponse, Citation

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, user: CurrentUser) -> ChatResponse:
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
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The language model is unavailable. Try again shortly."
        ) from e
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
