from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user
from app.domains.careertest import service
from app.domains.careertest.service import CareerNetError
from app.models import User

router = APIRouter(prefix="/api/career-test", tags=["career-test"])


def _require_configured() -> None:
    if not service.is_configured():
        raise HTTPException(status_code=503, detail="진로심리검사가 아직 설정되지 않았어요.")


@router.get("/questions")
async def get_questions(user: User = Depends(get_current_user)):
    """직업가치관검사(대학생/일반용) 문항 조회."""
    _require_configured()
    try:
        return await service.fetch_questions()
    except CareerNetError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


class ReportIn(BaseModel):
    answers: list[dict]
    trget_se: str = "100209"  # 100208=대학생, 100209=일반
    gender: str | None = None
    grade: str | None = None
    start_dtm: str | None = None


@router.post("/report")
async def post_report(body: ReportIn, user: User = Depends(get_current_user)):
    """답변 제출 → 커리어넷 리포트(결과 URL 등) 반환."""
    _require_configured()
    try:
        return await service.submit_report(
            answers=body.answers,
            trget_se=body.trget_se,
            gender=body.gender,
            grade=body.grade,
            start_dtm=body.start_dtm,
        )
    except CareerNetError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
