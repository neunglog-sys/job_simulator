"""회원가입 필수 약관 동의 입력 검증."""

import pytest
from pydantic import ValidationError

from app.domains.auth.schemas import SignupIn


def test_signup_requires_both_required_consents():
    base = {"email": "user@example.com", "password": "password123", "name": "테스터"}

    with pytest.raises(ValidationError):
        SignupIn(**base)

    with pytest.raises(ValidationError):
        SignupIn(**base, terms_agreed=True, privacy_agreed=False)


def test_signup_accepts_explicit_required_consents():
    body = SignupIn(
        email="user@example.com",
        password="password123",
        name="테스터",
        terms_agreed=True,
        privacy_agreed=True,
    )

    assert body.terms_agreed is True
    assert body.privacy_agreed is True
