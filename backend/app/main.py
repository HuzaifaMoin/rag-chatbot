import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.tracers.langchain import wait_for_all_tracers

from app.config import get_settings
from app.db import init_db
from app.demo import cleanup_loop
from app.embeddings import warm_up
from app.routers import auth, chat, conversations, documents, feedback, search

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await asyncio.to_thread(warm_up)
    cleanup = asyncio.create_task(cleanup_loop())  # deletes expired demo accounts
    yield
    cleanup.cancel()
    # Send any buffered LangSmith traces before the process exits.
    await asyncio.to_thread(wait_for_all_tracers)


app = FastAPI(title="RAG Chatbot API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(feedback.router)
app.include_router(conversations.router)


@app.get("/api/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
