from datetime import datetime

from pydantic import BaseModel


class ReportCreate(BaseModel):
    consultation_id: int
    simulation_id: int | None = None  # 완주한 시뮬레이션 — 있으면 수행 점수 50% 반영


class ReportOut(BaseModel):
    id: int
    status: str  # pending | done | failed
    consultation_id: int | None
    simulation_id: int | None
    fit_score: int | None
    strengths: list
    improvements: list
    advice: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
