from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


DocumentKind = Literal["resume", "portfolio", "other"]


class UserDocumentOut(BaseModel):
    id: int
    kind: DocumentKind
    original_name: str
    mime_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("이름을 입력해주세요.")
        return normalized


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=8, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class PolicyProfileIn(BaseModel):
    """맞춤 취업 지원제도 조회에 쓰는 프로필. 모든 항목이 선택이고, 준 항목만 반영한다."""

    birth_year: int | None = Field(default=None, ge=1900, le=2026)
    gender: Literal["male", "female"] | None = None
    region_ctpv: str | None = Field(default=None, max_length=30)
    region_sgg: str | None = Field(default=None, max_length=30)
    # 장애 여부는 민감정보라 동의 없이는 저장하지 않는다(개인정보보호법 §23).
    has_disability: bool | None = None
    sensitive_agreed: bool = False

    @field_validator("region_ctpv")
    @classmethod
    def known_ctpv(cls, value: str | None) -> str | None:
        # 지역 매칭이 정확 일치라, '서울'처럼 줄여 저장하면 조용히 아무것도 안 걸린다.
        from app.domains.policy import codes

        normalized = (value or "").strip()
        if not normalized:
            return None
        if normalized not in codes.CTPV_NAMES:
            raise ValueError(f"시도명은 정식 명칭이어야 해요. (예: {codes.CTPV_NAMES[0]})")
        return normalized

    @field_validator("region_sgg")
    @classmethod
    def clean_sgg(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class PolicyProfileOut(BaseModel):
    birth_year: int | None
    gender: str | None
    region_ctpv: str | None
    region_sgg: str | None
    has_disability: bool | None
    # 동의 시각 — 화면에서 '언제 동의했는지' 표시하고 철회 여부를 판단하는 데 쓴다.
    sensitive_agreed_at: datetime | None


class ProfileAccountOut(BaseModel):
    id: int
    email: str | None
    name: str
    has_password: bool
