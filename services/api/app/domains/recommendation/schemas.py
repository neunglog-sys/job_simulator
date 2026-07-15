from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class RecommendationRequest(BaseModel):
    consultation_id: int


class JobRecommendation(BaseModel):
    job_code: str
    job_title: str
    score: int  # 0~100 적합도
    reason: str
    # NCS 조사자료(배치1) 원본 — 미조사 직무는 필드 내부가 비어있을 수 있음
    education_requirement: dict | None = None
    salary: dict | None = None
    certifications: list = []
    scenario_slug: str | None = None


class RecommendationOut(BaseModel):
    id: int
    consultation_id: int
    results: list[JobRecommendation]
    feedback: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecommendationFeedbackRequest(BaseModel):
    feedback: Literal["helpful", "not_helpful"]
