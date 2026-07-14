"""소셜 로그인(OAuth 2.0 Authorization Code) — 백엔드 콜백 방식.

흐름: 프론트가 GET /api/auth/oauth/{provider}로 보내면 provider 인증 URL로 리다이렉트 →
사용자 동의 → provider가 /callback?code=..&state=..로 콜백 → 백엔드가 code를 토큰으로 교환,
프로필 조회, (provider,provider_user_id) 또는 이메일로 사용자 찾거나 생성, 우리 JWT 발급.

provider별로 다른 건 URL·scope·프로필 파싱뿐이라 registry 하나로 공통화한다.
client_id/secret이 비어 있으면 해당 provider는 미설정(503) — 시크릿만 채우면 활성화.
"""

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
import jwt
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import email_hash
from app.models import OAuthAccount, User

logger = logging.getLogger(__name__)

Profile = dict  # {"provider_user_id": str, "email": str|None, "name": str}


def _google_profile(d: dict) -> Profile:
    return {"provider_user_id": str(d["sub"]), "email": d.get("email"), "name": d.get("name") or ""}


def _kakao_profile(d: dict) -> Profile:
    account = d.get("kakao_account") or {}
    prof = account.get("profile") or {}
    return {
        "provider_user_id": str(d["id"]),
        "email": account.get("email"),
        "name": prof.get("nickname") or "카카오 사용자",
    }


def _naver_profile(d: dict) -> Profile:
    r = d.get("response") or {}
    return {
        "provider_user_id": str(r["id"]),
        "email": r.get("email"),
        "name": r.get("name") or r.get("nickname") or "네이버 사용자",
    }


@dataclass(frozen=True)
class ProviderConfig:
    authorize_url: str
    token_url: str
    userinfo_url: str
    scope: str
    parse: Callable[[dict], Profile]


PROVIDERS: dict[str, ProviderConfig] = {
    "google": ProviderConfig(
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
        scope="openid email profile",
        parse=_google_profile,
    ),
    "kakao": ProviderConfig(
        authorize_url="https://kauth.kakao.com/oauth/authorize",
        token_url="https://kauth.kakao.com/oauth/token",
        userinfo_url="https://kapi.kakao.com/v2/user/me",
        scope="profile_nickname account_email",  # account_email은 비즈앱 심사 필요할 수 있음
        parse=_kakao_profile,
    ),
    "naver": ProviderConfig(
        authorize_url="https://nid.naver.com/oauth2.0/authorize",
        token_url="https://nid.naver.com/oauth2.0/token",
        userinfo_url="https://openapi.naver.com/v1/nid/me",
        scope="",  # 네이버는 앱 설정에서 제공 항목 지정
        parse=_naver_profile,
    ),
}


def _creds(provider: str) -> tuple[str, str]:
    return {
        "google": (settings.oauth_google_client_id, settings.oauth_google_client_secret),
        "kakao": (settings.oauth_kakao_client_id, settings.oauth_kakao_client_secret),
        "naver": (settings.oauth_naver_client_id, settings.oauth_naver_client_secret),
    }[provider]


def get_config(provider: str) -> ProviderConfig:
    """미지원 provider는 404. 반환은 존재 보장."""
    config = PROVIDERS.get(provider)
    if config is None:
        raise HTTPException(status_code=404, detail=f"지원하지 않는 소셜 로그인: {provider}")
    return config


def is_configured(provider: str) -> bool:
    """client_id가 있으면 활성 — 없으면 라우터가 503으로 응답."""
    return bool(_creds(provider)[0])


def redirect_uri(provider: str) -> str:
    return f"{settings.oauth_redirect_base}/api/auth/oauth/{provider}/callback"


def make_state() -> str:
    """CSRF 방지용 서명 state(짧은 만료) — 서버 저장 없이 콜백에서 검증(stateless)."""
    payload = {"n": secrets.token_urlsafe(8), "exp": datetime.now(timezone.utc) + timedelta(minutes=10)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def verify_state(state: str) -> bool:
    try:
        jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
        return True
    except jwt.InvalidTokenError:
        return False


def authorize_url(provider: str, state: str) -> str:
    """provider 동의 화면 URL. 라우터가 여기로 리다이렉트한다."""
    config = get_config(provider)
    client_id, _ = _creds(provider)
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri(provider),
        "state": state,
    }
    if config.scope:
        params["scope"] = config.scope
    return str(httpx.URL(config.authorize_url, params=params))


async def _exchange_code(provider: str, code: str) -> str:
    """authorization code → access token."""
    config = get_config(provider)
    client_id, client_secret = _creds(provider)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": redirect_uri(provider),
    }
    if client_secret:
        data["client_secret"] = client_secret
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(config.token_url, data=data, headers={"Accept": "application/json"})
    res.raise_for_status()
    token = res.json().get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="소셜 로그인 토큰 교환 실패")
    return token


async def _fetch_profile(provider: str, access_token: str) -> Profile:
    config = get_config(provider)
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            config.userinfo_url, headers={"Authorization": f"Bearer {access_token}"}
        )
    res.raise_for_status()
    return config.parse(res.json())


async def _find_or_create_user(
    session: AsyncSession, provider: str, profile: Profile
) -> User:
    # 1) 이미 연결된 소셜 계정이면 그 사용자
    account = (
        await session.execute(
            select(OAuthAccount).where(
                OAuthAccount.provider == provider,
                OAuthAccount.provider_user_id == profile["provider_user_id"],
            )
        )
    ).scalar_one_or_none()
    if account:
        return await session.get(User, account.user_id)

    # 2) provider가 이메일을 주면, 같은 이메일의 기존 계정에 연결 (중복 가입 방지)
    user = None
    if profile.get("email"):
        user = (
            await session.execute(
                select(User).where(User.email_hash == email_hash(profile["email"]))
            )
        ).scalar_one_or_none()

    # 3) 없으면 비밀번호 없는 소셜 전용 계정 신규 생성
    if user is None:
        user = User(
            email=profile.get("email"),
            email_hash=email_hash(profile["email"]) if profile.get("email") else None,
            name=profile.get("name") or "사용자",
            pw_hash=None,
        )
        session.add(user)
        await session.flush()

    session.add(
        OAuthAccount(
            user_id=user.id, provider=provider, provider_user_id=profile["provider_user_id"]
        )
    )
    await session.commit()
    await session.refresh(user)
    return user


async def complete_login(session: AsyncSession, provider: str, code: str) -> User:
    """콜백 처리: code → 토큰 → 프로필 → 사용자 찾거나 생성."""
    get_config(provider)  # 미지원 provider 방어
    try:
        access_token = await _exchange_code(provider, code)
        profile = await _fetch_profile(provider, access_token)
    except HTTPException:
        raise
    except httpx.HTTPError:
        logger.exception("소셜 로그인 provider 통신 실패 (%s)", provider)
        raise HTTPException(status_code=502, detail="소셜 로그인 제공자와 통신에 실패했어요.")
    return await _find_or_create_user(session, provider, profile)
