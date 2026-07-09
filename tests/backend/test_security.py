"""core/security — 비밀번호 해싱·JWT."""

from app.core.security import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_roundtrip():
    stored = hash_password("password123")
    assert verify_password("password123", stored)


def test_wrong_password_rejected():
    stored = hash_password("password123")
    assert not verify_password("wrong-password", stored)


def test_same_password_different_salt():
    assert hash_password("password123") != hash_password("password123")


def test_malformed_stored_hash():
    assert not verify_password("password123", "garbage")
    assert not verify_password("password123", "")


def test_token_roundtrip():
    assert decode_token(create_token(42)) == 42


def test_tampered_token_rejected():
    token = create_token(42)
    assert decode_token(token[:-2] + "xx") is None
    assert decode_token("not.a.token") is None
