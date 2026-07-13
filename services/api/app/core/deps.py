"""공용 의존성 — 인증 우선순위: Bearer 토큰 > X-User-Id 스텁 > 데모 사용자.

스텁·데모 경로는 프론트 인증 연동 전 개발 편의용. 시연 전 제거 여부 팀 논의.
"""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import email_hash
from app.core.db import get_session
from app.core.security import decode_token
from app.models import User

DEMO_EMAIL = "demo@local"


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    authorization: str | None = Header(default=None),
    x_user_id: int | None = Header(default=None),
) -> User:
    # 1) JWT Bearer
    if authorization and authorization.lower().startswith("bearer "):
        user_id = decode_token(authorization.split(" ", 1)[1])
        if user_id is None:
            raise HTTPException(status_code=401, detail="유효하지 않은 토큰")
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="존재하지 않는 사용자")
        return user

    # 2) 개발용 스텁 헤더
    if x_user_id is not None:
        user = await session.get(User, x_user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="존재하지 않는 사용자")
        return user

    # 3) 데모 사용자 get-or-create (개발 편의)
    return await get_or_create_demo_user(session)


async def get_or_create_demo_user(session: AsyncSession) -> User:
    """이메일은 암호화 저장이라 반드시 email_hash로 조회 (WS 등 공용)."""
    user = (
        await session.execute(select(User).where(User.email_hash == email_hash(DEMO_EMAIL)))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=DEMO_EMAIL, email_hash=email_hash(DEMO_EMAIL), name="데모 사용자")
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user
