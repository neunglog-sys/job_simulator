import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
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
from app.domains.simulation.router import router as simulation_router
from app.domains.tts.router import router as tts_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 마이그레이션은 컨테이너 기동 커맨드(alembic upgrade head)에서 선행됨
    async with SessionFactory() as session:
        await seed_content(session)
        try:
            await ingest_knowledge(session)
        except Exception:  # noqa: BLE001 — 임베딩 장애(부팅 시 Gemini 다운 등)가 앱 기동을 막지 않게
            logger.exception(
                "지식 적재 실패 — RAG 없이 기동 계속 (다음 재기동 시 해시 가드로 자동 재적재)"
            )
    yield
    await redis_client.aclose()
    await engine.dispose()


app = FastAPI(title="나의 직무 아카데미아 API", lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """미처리 예외 → 프론트 에러 규약({detail})으로 통일 + 스택 로깅.

    기본 Starlette 500은 plain text라 프론트의 detail 파싱이 깨진다. HTTPException은
    FastAPI 기본 핸들러가 그대로 처리하므로 여기 안 온다.
    """
    logger.exception("미처리 예외: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "서버 오류가 발생했어요. 잠시 후 다시 시도해주세요."})

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
app.include_router(simulation_router)
app.include_router(tts_router)

# 게임 맵 정적 서빙 — /maps/<맵폴더>/<배경>.png 등. 폴더가 없으면(배포 초기 등) 조용히 생략:
# 게임 API의 map 필드도 None이 되어 프론트는 기존 module 배경으로 폴백한다.
if Path(settings.maps_dir).is_dir():
    app.mount("/maps", StaticFiles(directory=settings.maps_dir), name="maps")
else:
    logger.warning("maps/ 폴더 없음 — 게임 맵 정적 서빙 비활성 (compose 볼륨 확인)")


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
