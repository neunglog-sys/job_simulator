from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.security import create_token, hash_password, verify_password
from app.domains.auth.schemas import LoginIn, MeOut, SignupIn, TokenOut
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenOut, status_code=201)
async def signup(body: SignupIn, session: AsyncSession = Depends(get_session)):
    exists = (
        await session.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="이미 가입된 이메일")
    user = User(email=body.email, name=body.name, pw_hash=hash_password(body.password))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return TokenOut(access_token=create_token(user.id))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    user = (
        await session.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if user is None or not user.pw_hash or not verify_password(body.password, user.pw_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않음")
    return TokenOut(access_token=create_token(user.id))


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)):
    return user
