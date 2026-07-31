from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.knowledge import search_knowledge
from app.core.db import get_session
from app.domains.jobs.schemas import JobOut, KnowledgeChunkOut
from app.models import Job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobOut])
async def list_jobs(session: AsyncSession = Depends(get_session)):
    return list((await session.execute(select(Job).order_by(Job.code))).scalars())


@router.get("/{code}", response_model=JobOut)
async def get_job(code: str, session: AsyncSession = Depends(get_session)):
    job = (
        await session.execute(select(Job).where(Job.code == code))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail=f"직무 없음: {code}")
    return job


@router.get("/{code}/knowledge", response_model=list[KnowledgeChunkOut])
async def knowledge(
    code: str,
    q: str = Query(min_length=1, max_length=200),
    top_k: int = Query(default=5, ge=1, le=20),
    session: AsyncSession = Depends(get_session),
):
    """직무 지식 검색 (RAG) — 데이터 적재 확인·NPC 지식 주입용."""
    try:
        return await search_knowledge(session, q, job_code=code, top_k=top_k)
    except Exception as e:  # noqa: BLE001 — 임베딩/검색 실패를 raw 500 대신 503으로
        raise HTTPException(
            status_code=503, detail="지식 검색을 일시적으로 사용할 수 없어요."
        ) from e
