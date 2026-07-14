"""auth/oauth — 소셜 로그인 프레임(시크릿·실HTTP 없이 순수 로직·라우팅 검증)."""

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.crypto import email_hash
from app.domains.auth import oauth
from app.models import OAuthAccount, User


def test_profile_parsers():
    assert oauth._google_profile({"sub": "g1", "email": "a@x.com", "name": "구글"})["provider_user_id"] == "g1"
    k = oauth._kakao_profile({"id": 77, "kakao_account": {"email": "k@x.com", "profile": {"nickname": "카카오맨"}}})
    assert k["provider_user_id"] == "77" and k["name"] == "카카오맨" and k["email"] == "k@x.com"
    n = oauth._naver_profile({"response": {"id": "n9", "email": "n@x.com", "name": "네이버"}})
    assert n["provider_user_id"] == "n9" and n["name"] == "네이버"


def test_kakao_profile_without_email_has_fallback_name():
    p = oauth._kakao_profile({"id": 1, "kakao_account": {}})
    assert p["email"] is None and p["name"] == "카카오 사용자"


def test_unsupported_provider_404():
    with pytest.raises(HTTPException) as exc:
        oauth.get_config("facebook")
    assert exc.value.status_code == 404


def test_is_configured_reflects_secret(monkeypatch):
    monkeypatch.setattr(settings, "oauth_google_client_id", "")
    assert oauth.is_configured("google") is False
    monkeypatch.setattr(settings, "oauth_google_client_id", "client-123")
    assert oauth.is_configured("google") is True


def test_authorize_url_has_required_params(monkeypatch):
    monkeypatch.setattr(settings, "oauth_google_client_id", "client-123")
    url = oauth.authorize_url("google", "state-abc")
    assert "accounts.google.com" in url
    assert "client_id=client-123" in url
    assert "state=state-abc" in url
    assert "redirect_uri=" in url and "scope=" in url


def test_state_roundtrip_and_reject():
    state = oauth.make_state()
    assert oauth.verify_state(state) is True
    assert oauth.verify_state("garbage.token.here") is False


@pytest.mark.asyncio(loop_scope="session")
async def test_find_or_create_new_user(db_session):
    profile = {"provider_user_id": "g-new-1", "email": "newuser@x.com", "name": "새유저"}
    user = await oauth._find_or_create_user(db_session, "google", profile)
    assert user.id and user.pw_hash is None  # 소셜 전용 = 비번 없음
    # 같은 provider_user_id로 다시 오면 같은 사용자 (중복 생성 X)
    again = await oauth._find_or_create_user(db_session, "google", profile)
    assert again.id == user.id


@pytest.mark.asyncio(loop_scope="session")
async def test_links_to_existing_email_account(db_session):
    # 이메일/비번으로 이미 가입한 사용자
    existing = User(email="linkme@x.com", email_hash=email_hash("linkme@x.com"), name="기존", pw_hash="x")
    db_session.add(existing)
    await db_session.flush()
    # 같은 이메일로 소셜 로그인 → 새 계정 만들지 않고 기존에 연결
    user = await oauth._find_or_create_user(
        db_session, "kakao", {"provider_user_id": "k-1", "email": "linkme@x.com", "name": "기존"}
    )
    assert user.id == existing.id
    account = (
        await db_session.execute(
            OAuthAccount.__table__.select().where(OAuthAccount.user_id == existing.id)
        )
    ).first()
    assert account is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_router_unsupported_provider_404(client):
    res = await client.get("/api/auth/oauth/facebook", follow_redirects=False)
    assert res.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_router_unconfigured_provider_503(client, monkeypatch):
    monkeypatch.setattr(settings, "oauth_google_client_id", "")
    res = await client.get("/api/auth/oauth/google", follow_redirects=False)
    assert res.status_code == 503


@pytest.mark.asyncio(loop_scope="session")
async def test_router_start_redirects_when_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "oauth_google_client_id", "client-123")
    res = await client.get("/api/auth/oauth/google", follow_redirects=False)
    assert res.status_code in (302, 307)
    assert "accounts.google.com" in res.headers["location"]


@pytest.mark.asyncio(loop_scope="session")
async def test_callback_bad_state_400(client):
    res = await client.get(
        "/api/auth/oauth/google/callback?code=abc&state=bad", follow_redirects=False
    )
    assert res.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_callback_missing_code_400(client):
    res = await client.get("/api/auth/oauth/google/callback", follow_redirects=False)
    assert res.status_code == 400
