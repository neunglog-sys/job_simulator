from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class RecommendationRequest(BaseModel):
    consultation_id: int


class JobRecommendation(BaseModel):
    job_code: str
    job_title: str
    # 직무 자체에 대한 객관적 설명 (jobs.description) — reason(추천 사유)과 별개.
    # nullable인 이유: recommendations.results는 생성 시점 스냅샷이라, 이 필드 추가 이전에
    # 저장된 기존 행에는 값이 없다 — 필수로 두면 과거 추천 조회가 전부 500 난다.
    description: str | None = None
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
