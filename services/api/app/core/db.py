from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# 풀 크기를 명시한다 — 기본값(pool 5 + overflow 10 = 15)은 Supabase 세션 풀러의
# "max clients 15" 한도와 정확히 맞물려, 동시 요청이 몰리면 초과분이
# asyncpg EMAXCONNSESSION → 500으로 떨어진다(실측: 동시 20건 중 9건 실패, 프로덕션 동일).
# 팀 전원이 같은 DB를 공유하므로 한 인스턴스가 한도를 다 쓰면 안 된다.
# 넘치는 요청은 커넥션을 기다렸다가(대기 최대 pool_timeout) 처리 — 500 대신 약간의 지연.
# pool_pre_ping: 풀러가 끊은 죽은 커넥션을 재사용하다 나는 간헐적 오류 방지.
engine = create_async_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_recycle=1800,
    pool_pre_ping=True,
)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncSession:
    async with SessionFactory() as session:
        yield session
