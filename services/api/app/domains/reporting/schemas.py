from datetime import datetime

from pydantic import BaseModel


class ReportCreate(BaseModel):
    consultation_id: int


class ReportOut(BaseModel):
    id: int
    status: str  # pending | done | failed
    consultation_id: int | None
    fit_score: int | None
    strengths: list
    improvements: list
    advice: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
