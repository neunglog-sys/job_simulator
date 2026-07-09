from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = create_async_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(app.state.engine)
    app.state.redis = aioredis.from_url(settings.redis_url)
    yield
    await app.state.redis.aclose()
    await app.state.engine.dispose()


app = FastAPI(title="나의 직무 아카데미아 API", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/deep")
async def health_deep():
    """DB·Redis 연결까지 확인하는 헬스체크 (도커 배선 검증용)."""
    async with app.state.session_factory() as session:
        pgvector = (
            await session.execute(
                text("SELECT count(*) FROM pg_extension WHERE extname = 'vector'")
            )
        ).scalar_one()
    await app.state.redis.ping()
    return {"status": "ok", "db": "ok", "pgvector": bool(pgvector), "redis": "ok"}
