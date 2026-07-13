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


class RecommendationOut(BaseModel):
    id: int
    consultation_id: int
    results: list[JobRecommendation]
    feedback: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecommendationFeedbackRequest(BaseModel):
    feedback: Literal["helpful", "not_helpful"]
