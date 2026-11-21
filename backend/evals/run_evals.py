"""Run the evals: the real agent answers every question in dataset.py, and the evaluators score it.

    cd backend
    uv run python -m evals.run_evals

Needs Postgres running (docker compose up -d --wait) plus GROQ_API_KEY and LANGSMITH_API_KEY.
Uses its own database ("rag_eval"), so your normal data is never touched.
Exits with code 1 if correctness is below EVAL_MIN_CORRECTNESS (default 0.8): the quality gate.
"""

import asyncio
import os
import sys
from collections import defaultdict
from pathlib import Path

# Must happen BEFORE the app is imported (app/db.py connects at import time).
EVAL_DATABASE_URL = os.environ.get(
    "EVAL_DATABASE_URL", "postgresql+asyncpg://rag:rag@localhost:5432/rag_eval"
)
os.environ["DATABASE_URL"] = EVAL_DATABASE_URL

import asyncpg  # noqa: E402
from langsmith import Client  # noqa: E402
from langsmith.evaluation import aevaluate  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.agent.graph import run_agent  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.ingestion import ingest_document  # noqa: E402
from app.models import Document, DocumentStatus, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from evals.dataset import DATASET_NAME, EXAMPLES  # noqa: E402
from evals.evaluators import EVALUATORS, JUDGE_MODEL  # noqa: E402

HANDBOOK = Path(__file__).parent / "data" / "northwind_handbook.md"
EVAL_USER_EMAIL = "eval-bot@northwind.example"
MIN_CORRECTNESS = float(os.environ.get("EVAL_MIN_CORRECTNESS", "0.8"))


# ---- 1. A separate database with the handbook uploaded ----


async def create_eval_database() -> None:
    dsn = EVAL_DATABASE_URL.replace("+asyncpg", "")
    base_dsn, db_name = dsn.rsplit("/", 1)
    conn = await asyncpg.connect(f"{base_dsn}/postgres", timeout=5)
    try:
        if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", db_name):
            await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()


async def prepare_eval_user() -> User:
    """Create the eval user if needed and (re)upload the handbook, so it always matches the file."""
    await create_eval_database()
    await init_db()
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.email == EVAL_USER_EMAIL))
        if user is None:
            user = User(email=EVAL_USER_EMAIL, password_hash=hash_password(os.urandom(16).hex()))
            session.add(user)
        await session.execute(delete(Document).where(Document.owner_id == user.id))
        doc = Document(owner=user, filename=HANDBOOK.name)
        session.add(doc)
        await session.commit()
        doc_id, user_id = doc.id, user.id

    await ingest_document(doc_id, HANDBOOK.read_bytes(), HANDBOOK.name)
    async with SessionLocal() as session:
        doc = await session.get(Document, doc_id)
        if doc.status != DocumentStatus.ready:
            raise RuntimeError(f"Handbook ingestion failed: {doc.error}")
        print(f"Handbook uploaded: {doc.num_chunks} chunks")
        return await session.get(User, user_id)


# ---- 2. The dataset in LangSmith, kept in sync with dataset.py ----


def _expected(ex: dict) -> dict:
    return {"answer": ex["answer"], "category": ex["category"], "sources": ex["sources"]}


def sync_dataset(client: Client) -> None:
    """Add, update or remove questions IN PLACE (never delete the dataset: that would also
    delete every past experiment). LangSmith versions the dataset, so old runs stay comparable."""
    if client.has_dataset(dataset_name=DATASET_NAME):
        dataset = client.read_dataset(dataset_name=DATASET_NAME)
    else:
        dataset = client.create_dataset(
            DATASET_NAME, description="Questions about the fictional Northwind handbook."
        )

    existing = {ex.inputs["question"]: ex for ex in client.list_examples(dataset_id=dataset.id)}
    wanted = {ex["question"]: ex for ex in EXAMPLES}

    to_create = [q for q in wanted if q not in existing]
    to_update = [q for q in wanted if q in existing and existing[q].outputs != _expected(wanted[q])]
    to_delete = [existing[q].id for q in existing if q not in wanted]

    if to_create:
        client.create_examples(
            dataset_id=dataset.id,
            examples=[
                {
                    "inputs": {"question": q},
                    "outputs": _expected(wanted[q]),
                    "metadata": {"category": wanted[q]["category"]},
                }
                for q in to_create
            ],
        )
    for q in to_update:
        client.update_example(existing[q].id, outputs=_expected(wanted[q]))
    if to_delete:
        client.delete_examples(to_delete)
    print(
        f"Dataset '{DATASET_NAME}': {len(wanted)} questions "
        f"({len(to_create)} added, {len(to_update)} updated, {len(to_delete)} removed)"
    )


# ---- 3. Run the agent on every question and score it ----


async def main() -> int:
    if not get_settings().groq_api_key or not os.environ.get("LANGSMITH_API_KEY"):
        print("GROQ_API_KEY and LANGSMITH_API_KEY must be set.")
        return 2

    user = await prepare_eval_user()
    client = Client()
    sync_dataset(client)

    async def target(inputs: dict) -> dict:
        """The 'student': the same agent /api/chat uses, answering as the eval user."""
        state, _run_id, _thread = await run_agent(question=inputs["question"], owner_id=user.id)
        return {
            "answer": state.get("answer", ""),
            "source": state.get("source"),
            "citations": state.get("citations") or [],
            "grounded": state.get("grounded"),
        }

    s = get_settings()
    results = await aevaluate(
        target,
        data=DATASET_NAME,
        evaluators=EVALUATORS,
        experiment_prefix="rag-agent",
        metadata={"fast_model": s.fast_model, "answer_model": s.answer_model, "judge": JUDGE_MODEL},
        max_concurrency=1,  # one question at a time: Groq free-tier rate limits
        client=client,
    )

    # ---- 4. Summary + quality gate ----
    totals: dict[str, list[float]] = defaultdict(list)
    failures: list[str] = []
    async for row in results:
        question = row["example"].inputs["question"]
        for res in row["evaluation_results"]["results"]:
            if res.score is None:
                continue
            totals[res.key].append(res.score)
            if res.score < 1:
                failures.append(f"  ✗ {res.key:<17} {question[:70]}\n      {res.comment}")

    print("\nResults")
    for key in ("correctness", "right_source", "cites_sources", "no_hallucination"):
        scores = totals.get(key, [])
        if scores:
            passed, total = sum(scores), len(scores)
            print(f"  {key:<17} {passed:>4.0f}/{total:<3} {passed / total:>5.0%}")
    if failures:
        print("\nFailed checks")
        print("\n".join(failures))
    print(f"\nFull results in LangSmith: {results.url}")

    correctness_scores = totals.get("correctness", [])
    rate = sum(correctness_scores) / len(correctness_scores) if correctness_scores else 0.0
    if rate < MIN_CORRECTNESS:
        print(f"\nQUALITY GATE FAILED: correctness {rate:.0%} < {MIN_CORRECTNESS:.0%}")
        return 1
    print(f"\nQuality gate passed: correctness {rate:.0%} >= {MIN_CORRECTNESS:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
