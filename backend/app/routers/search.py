from dataclasses import asdict

from fastapi import APIRouter

from app.deps import CurrentUser, SessionDep
from app.retrieval import hybrid_search
from app.schemas import SearchHit, SearchRequest

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("", response_model=list[SearchHit])
async def search(body: SearchRequest, session: SessionDep, user: CurrentUser) -> list[SearchHit]:
    """Raw retrieval endpoint (hybrid + rerank). Useful for debugging and evals."""
    hits = await hybrid_search(session, user.id, body.query, body.k, body.document_ids)
    return [SearchHit(**asdict(h)) for h in hits]
