import uuid

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.conversations import get_owned_conversation
from app.deps import CurrentUser, SessionDep
from app.models import Conversation
from app.schemas import ConversationDetail, ConversationOut, ConversationRename

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(session: SessionDep, user: CurrentUser) -> list[Conversation]:
    """Your saved chats, most recently used first."""
    result = await session.scalars(
        select(Conversation)
        .where(Conversation.owner_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    return list(result)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Conversation:
    """One chat with all its messages (answers include their sources and steps)."""
    await get_owned_conversation(session, user.id, conversation_id)
    return await session.scalar(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(
    conversation_id: uuid.UUID, body: ConversationRename, session: SessionDep, user: CurrentUser
) -> Conversation:
    conversation = await get_owned_conversation(session, user.id, conversation_id)
    conversation.title = body.title.strip() or conversation.title
    await session.commit()
    await session.refresh(conversation)
    return conversation


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    conversation = await get_owned_conversation(session, user.id, conversation_id)
    await session.delete(conversation)
    await session.commit()
