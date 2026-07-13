from datetime import datetime

from pydantic import BaseModel, Field


class ConsultationOut(BaseModel):
    id: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class SurveyIn(BaseModel):
    answers: dict[str, str]  # {question_id: option_key} — 전 문항 필수


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
