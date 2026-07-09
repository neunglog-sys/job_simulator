from datetime import datetime

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
    created_at: datetime

    model_config = {"from_attributes": True}
