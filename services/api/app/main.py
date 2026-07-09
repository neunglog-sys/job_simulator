import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.content.knowledge import ingest_knowledge
from app.content.seed import seed_content
from app.core.config import settings
from app.core.db import SessionFactory, engine
from app.core.redis import redis_client
from app.domains.auth.router import router as auth_router
from app.domains.consultation.router import router as consultation_router
from app.domains.jobs.router import router as jobs_router
from app.domains.recommendation.router import router as recommendation_router
from app.domains.reporting.router import router as reporting_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 마이그레이션은 컨테이너 기동 커맨드(alembic upgrade head)에서 선행됨
    async with SessionFactory() as session:
        await seed_content(session)
        await ingest_knowledge(session)
    yield
    await redis_client.aclose()
    await engine.dispose()


app = FastAPI(title="나의 직무 아카데미아 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(consultation_router)
app.include_router(recommendation_router)
app.include_router(jobs_router)
app.include_router(reporting_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/deep")
async def health_deep():
    """DB·pgvector·Redis 배선 검증용 헬스체크."""
    async with SessionFactory() as session:
        pgvector = (
            await session.execute(
                text("SELECT count(*) FROM pg_extension WHERE extname = 'vector'")
            )
        ).scalar_one()
    await redis_client.ping()
    return {"status": "ok", "db": "ok", "pgvector": bool(pgvector), "redis": "ok"}
