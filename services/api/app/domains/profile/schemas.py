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


class ProfileAccountOut(BaseModel):
    id: int
    email: str | None
    name: str
    has_password: bool
