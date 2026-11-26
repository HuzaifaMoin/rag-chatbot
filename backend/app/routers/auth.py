from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.demo import create_guest, delete_expired_guests, guest_info
from app.deps import CurrentUser, SessionDep
from app.models import User
from app.schemas import RegisterRequest, TokenResponse, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, session: SessionDep) -> TokenResponse:
    email = body.email.lower()
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(email=email, password_hash=hash_password(body.password))
    session.add(user)
    await session.commit()
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], session: SessionDep
) -> TokenResponse:
    # OAuth2 form uses "username"; we treat it as the email.
    user = await session.scalar(select(User).where(User.email == form.username.lower()))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/guest", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def start_demo(request: Request, session: SessionDep) -> TokenResponse:
    """Start the demo: a fresh guest account with the Northwind handbook preloaded.
    It lasts guest_ttl_hours and can ask guest_daily_questions questions a day."""
    await delete_expired_guests(session)  # tidy up as we go (also done every 30 min)
    ip = request.client.host if request.client else "unknown"
    user = await create_guest(session, ip)
    info = await guest_info(session, user.id)
    # The token stops working when the account is deleted, so it needn't outlive it.
    return TokenResponse(
        access_token=create_access_token(user.id, expires_in=info.expires_at - datetime.now(UTC))
    )


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, session: SessionDep) -> UserOut:
    out = UserOut.model_validate(user)
    out.guest = await guest_info(session, user.id)
    return out
