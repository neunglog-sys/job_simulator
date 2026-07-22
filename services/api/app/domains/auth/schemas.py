from typing import Literal

from pydantic import BaseModel, EmailStr, Field


TERMS_VERSION = "2026.07.20"
PRIVACY_VERSION = "2026.07.20"


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    name: str = Field(min_length=1, max_length=100)
    terms_agreed: Literal[True]
    privacy_agreed: Literal[True]


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(BaseModel):
    id: int
    email: str | None
    name: str
    has_password: bool

    model_config = {"from_attributes": True}
