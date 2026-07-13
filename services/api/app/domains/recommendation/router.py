from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.deps import get_current_user
from app.domains.recommendation import service
from app.domains.recommendation.schemas import (
    RecommendationFeedbackRequest,
    RecommendationOut,
    RecommendationRequest,
)
from app.models import User

router = APIRouter(prefix="/api/recommendations", tags=["recommendation"])


@router.post("", response_model=RecommendationOut, status_code=201)
async def create_recommendation(
    body: RecommendationRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """상담 대화를 분석해 적합 직무 상위 3개를 추천. 상담 세션은 completed 처리됨."""
    return await service.create_recommendation(session, user, body.consultation_id)


@router.get("/{recommendation_id}", response_model=RecommendationOut)
async def get_recommendation(
    recommendation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await service.get_recommendation(session, recommendation_id, user)


@router.patch("/{recommendation_id}/feedback", response_model=RecommendationOut)
async def set_recommendation_feedback(
    recommendation_id: int,
    body: RecommendationFeedbackRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """추천 결과에 대한 사용자 피드백(도움됨/안됨) 기록. 향후 스코어링 튜닝 근거로 사용."""
    return await service.set_recommendation_feedback(
        session, recommendation_id, user, body.feedback
    )
