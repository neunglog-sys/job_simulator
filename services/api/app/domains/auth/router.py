from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import email_hash
from app.core.db import get_session
from app.core.deps import get_current_user
from app.core.security import create_token, hash_password, verify_password
from app.domains.auth import oauth
from app.domains.auth.schemas import (
    PRIVACY_VERSION,
    TERMS_VERSION,
    LoginIn,
    MeOut,
    SignupIn,
    TokenOut,
)
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenOut, status_code=201)
async def signup(body: SignupIn, session: AsyncSession = Depends(get_session)):
    exists = (
        await session.execute(select(User).where(User.email_hash == email_hash(body.email)))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="이미 가입된 이메일")
    agreed_at = datetime.now(timezone.utc)
    user = User(
        email=body.email,
        email_hash=email_hash(body.email),
        name=body.name,
        pw_hash=hash_password(body.password),
        terms_agreed_at=agreed_at,
        terms_version=TERMS_VERSION,
        privacy_agreed_at=agreed_at,
        privacy_version=PRIVACY_VERSION,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return TokenOut(access_token=create_token(user.id))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)):
    user = (
        await session.execute(select(User).where(User.email_hash == email_hash(body.email)))
    ).scalar_one_or_none()
    if user is None or not user.pw_hash or not verify_password(body.password, user.pw_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않음")
    return TokenOut(access_token=create_token(user.id))


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.get("/oauth/{provider}")
async def oauth_start(provider: str):
    """소셜 로그인 시작 — provider 동의 화면으로 리다이렉트. 프론트는 이 URL로 이동만 하면 된다."""
    oauth.get_config(provider)  # 미지원 provider → 404
    if not oauth.is_configured(provider):
        raise HTTPException(status_code=503, detail=f"{provider} 소셜 로그인이 아직 설정되지 않았어요.")
    return RedirectResponse(oauth.authorize_url(provider, oauth.make_state()))


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """provider 콜백 — code를 우리 JWT로 바꿔 프론트로 리다이렉트({frontend}/#access_token=..).

    토큰을 URL 프래그먼트(#)로 실어 서버 로그·리퍼러에 남지 않게 한다.
    """
    if error or not code:
        raise HTTPException(status_code=400, detail="소셜 로그인이 취소되었거나 실패했어요.")
    if not state or not oauth.verify_state(state):  # CSRF 방지
        raise HTTPException(status_code=400, detail="유효하지 않은 로그인 요청이에요. 다시 시도해주세요.")
    user = await oauth.complete_login(session, provider, code, state)
    token = create_token(user.id)
    return RedirectResponse(f"{settings.frontend_url}/#access_token={token}")
