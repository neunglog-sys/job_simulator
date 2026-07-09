"""공용 의존성 — auth는 §9 계획대로 마지막에 구현, 그 전까지 X-User-Id 스텁."""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models import User

DEMO_EMAIL = "demo@local"


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    x_user_id: int | None = Header(default=None),
) -> User:
    if x_user_id is not None:
        user = await session.get(User, x_user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="존재하지 않는 사용자")
        return user

    # 헤더 없으면 데모 사용자 get-or-create (개발 편의)
    user = (
        await session.execute(select(User).where(User.email == DEMO_EMAIL))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=DEMO_EMAIL, name="데모 사용자")
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user
