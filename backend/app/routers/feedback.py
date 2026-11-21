import logging
import os
import uuid
from functools import lru_cache

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from langsmith import Client
from langsmith.address import address_from_env

from app.deps import CurrentUser, SessionDep
from app.models import ChatRun
from app.schemas import FeedbackRequest

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)

FEEDBACK_KEY = "user_score"
# Fixed namespace so the same run always maps to the same LangSmith feedback id.
_FEEDBACK_NAMESPACE = uuid.UUID("5f0c2f38-7c1e-4d55-9a1b-2b7f4c6d9e10")


def feedback_id_for(run_id: uuid.UUID) -> uuid.UUID:
    """One feedback id per answer: the first vote creates it, later votes update it."""
    return uuid.uuid5(_FEEDBACK_NAMESPACE, str(run_id))


def langsmith_enabled() -> bool:
    return os.getenv("LANGSMITH_TRACING", "").lower() == "true" and bool(
        os.getenv("LANGSMITH_API_KEY")
    )


@lru_cache
def _client() -> Client:
    return Client()


def send_to_langsmith(run_id: uuid.UUID, score: int, first_vote: bool) -> None:
    """Background task: attach the vote to the answer's trace in LangSmith."""
    if not langsmith_enabled():
        return
    try:
        if first_vote:
            _client().create_feedback(
                run_id,
                FEEDBACK_KEY,
                score=score,
                feedback_id=feedback_id_for(run_id),
                # Where the run was traced (LANGSMITH_AGENT_ID + LANGSMITH_AGENT_ENVIRONMENT),
                # so LangSmith can find it.
                address=address_from_env(),
            )
        else:
            _client().update_feedback(feedback_id_for(run_id), score=score)
    except Exception:
        # The vote is already saved in our database; a LangSmith hiccup shouldn't bother the user.
        logger.exception("Could not send feedback for run %s to LangSmith", run_id)


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def give_feedback(
    body: FeedbackRequest, background: BackgroundTasks, session: SessionDep, user: CurrentUser
) -> None:
    """Rate an answer 👍 (1) or 👎 (0). Voting again changes your vote."""
    run = await session.get(ChatRun, body.run_id)
    # 404 (not 403) for other users' answers, so run ids can't be probed.
    if run is None or run.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")

    first_vote = run.score is None
    run.score = body.score
    await session.commit()
    background.add_task(send_to_langsmith, run.id, body.score, first_vote)
