import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import DocumentStatus


class RegisterRequest(BaseModel):
    email: EmailStr
    # bcrypt only uses the first 72 bytes, so cap the length.
    password: str = Field(min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    created_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    filename: str
    status: DocumentStatus
    error: str | None
    num_chunks: int
    created_at: datetime


class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    chunk_index: int
    page: int | None
    content: str


class DocumentText(BaseModel):
    """A document's text for the viewer: its passages in order (original files aren't kept)."""

    document: DocumentOut
    chunks: list[ChunkOut]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=5, ge=1, le=20)
    document_ids: list[uuid.UUID] | None = None


class SearchHit(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    page: int | None
    content: str
    score: float


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    document_ids: list[uuid.UUID] | None = None
    thread_id: str | None = Field(default=None, max_length=100)
    # Continue a saved chat: the backend loads its history (and ignores `history`).
    # Leave empty to start a new conversation.
    conversation_id: uuid.UUID | None = None
    # Regenerate: drop the chat's last question + answer first, then ask again.
    replace_last: bool = False


class Citation(BaseModel):
    label: str  # "1", "2"... for documents, "W1", "W2"... for web results
    type: Literal["document", "web"]
    snippet: str
    # document citations
    document_id: uuid.UUID | None = None
    chunk_id: uuid.UUID | None = None
    filename: str | None = None
    page: int | None = None
    # web citations
    title: str | None = None
    url: str | None = None


class ChatResponse(BaseModel):
    answer: str
    source: Literal["documents", "web", "calculator", "general", "none", "blocked"]
    citations: list[Citation]
    grounded: bool | None  # None when no grounding check ran (web / blocked)
    tools_used: list[str]
    search_query: str | None
    thread_id: str
    run_id: uuid.UUID  # LangSmith trace id, used for feedback
    latency_ms: int
    conversation_id: uuid.UUID | None = None  # the saved chat this answer belongs to


class FeedbackRequest(BaseModel):
    run_id: uuid.UUID
    score: Literal[0, 1]  # 1 = 👍, 0 = 👎
    comment: str | None = Field(default=None, max_length=1000)  # optional "what was wrong?"


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    role: Literal["user", "assistant"]
    content: str
    response: dict | None  # ChatResponse fields (+ "steps") for answers


class ConversationDetail(ConversationOut):
    messages: list[ChatMessageOut]


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)
