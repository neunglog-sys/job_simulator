from datetime import datetime

from pydantic import BaseModel, Field


class ConsultationOut(BaseModel):
    id: int
    status: str
    created_at: datetime
    # 아바타 인사 사전 렌더 클립 — 있으면 프론트가 세션 진입 즉시 재생 (첫 발화 생성 0초).
    # 클립 파일은 아바타 담당이 storage/avatar-clips/greeting.mp4 로 배치 (계약: docs/avatar-greeting-clip.md)
    greeting_clip_url: str | None = None

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
