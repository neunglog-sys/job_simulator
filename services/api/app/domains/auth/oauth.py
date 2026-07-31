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
from urllib.parse import urlsplit

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
    return {
        "provider_user_id": str(d["sub"]),
        "email": d.get("email"),
        # 구글은 email_verified를 준다. 이 값이 참일 때만 기존 계정에 연결한다.
        "email_verified": d.get("email_verified") is True,
        "name": d.get("name") or "",
    }


def _kakao_profile(d: dict) -> Profile:
    account = d.get("kakao_account") or {}
    prof = account.get("profile") or {}
    return {
        "provider_user_id": str(d["id"]),
        "email": account.get("email"),
        "email_verified": account.get("is_email_verified") is True,
        "name": prof.get("nickname") or "카카오 사용자",
    }


def _naver_profile(d: dict) -> Profile:
    r = d.get("response") or {}
    return {
        "provider_user_id": str(r["id"]),
        "email": r.get("email"),
        # 네이버는 인증 여부 필드를 주지 않는다 → 확인할 수 없으므로 연결에 쓰지 않는다.
        "email_verified": False,
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
        # 이메일(account_email)은 카카오 비즈앱 전환이 있어야 동의항목에 넣을 수 있어 기본은 닉네임만.
        # 비즈앱 전환하면 "profile_nickname account_email"로 되돌리면 이메일도 수집(코드 그대로 동작).
        scope="profile_nickname",
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


def _allowed_frontend_origin(origin: str | None) -> str | None:
    """Return a normalized, allow-listed frontend origin for the OAuth callback."""
    if not origin:
        return None

    try:
        parsed = urlsplit(origin)
    except ValueError:
        return None

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return None

    normalized = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    allowed = {
        candidate.strip().rstrip("/")
        for candidate in settings.cors_origins.split(",")
        if candidate.strip()
    }
    allowed.add(settings.frontend_url.rstrip("/"))
    return normalized if normalized in allowed else None


STATE_COOKIE = "oauth_nonce"
STATE_TTL_S = 600


def make_state(frontend_origin: str | None = None) -> tuple[str, str]:
    """CSRF 방지용 서명 state와, 그에 짝이 되는 nonce를 만든다.

    (state, nonce)를 함께 돌려주고 라우터가 nonce를 쿠키로 심는다. 서명만으로는
    부족하다 — 서버가 발급한 state면 **어느 브라우저에서 와도** 통과하기 때문에,
    공격자가 자기 계정으로 받은 code와 정상 state를 피해자 브라우저에 열게 하면
    피해자가 공격자 계정으로 로그인된 채 활동하게 된다(로그인 CSRF).
    콜백에서 쿠키의 nonce와 state 속 nonce가 같은지 봐서 같은 브라우저인지 확인한다.
    """
    nonce = secrets.token_urlsafe(16)
    payload = {
        "n": nonce,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=STATE_TTL_S),
    }
    allowed_origin = _allowed_frontend_origin(frontend_origin)
    if allowed_origin:
        payload["frontend_origin"] = allowed_origin
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), nonce


def verify_state(state: str, nonce: str | None) -> bool:
    """서명·만료에 더해, 이 브라우저가 로그인을 시작한 그 브라우저인지까지 확인한다."""
    if not nonce:
        return False
    try:
        payload = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    return secrets.compare_digest(str(payload.get("n") or ""), nonce)


def frontend_origin_from_state(state: str) -> str | None:
    """Read the validated frontend origin embedded in a signed OAuth state."""
    try:
        payload = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    return _allowed_frontend_origin(payload.get("frontend_origin"))


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


async def _exchange_code(provider: str, code: str, state: str) -> str:
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
    if provider == "naver":
        data["state"] = state  # 네이버 토큰 교환은 state 필수
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

    # 2) 같은 이메일의 기존 계정에 연결 (중복 가입 방지).
    #    ⚠️ provider가 '인증된 이메일'이라고 확인해 준 경우에만 연결한다.
    #    인증 안 된 이메일로도 연결하면, 남의 이메일 주소를 적어 만든 소셜 계정으로
    #    로그인하는 것만으로 그 사람의 기존 계정을 그대로 차지할 수 있다(계정 탈취).
    #    네이버는 인증 여부를 주지 않아 항상 새 계정이 된다 — 연결이 필요하면
    #    로그인 후 계정 설정에서 본인 확인을 거쳐 잇는 흐름을 따로 만들어야 한다.
    user = None
    if profile.get("email") and profile.get("email_verified"):
        user = (
            await session.execute(
                select(User).where(User.email_hash == email_hash(profile["email"]))
            )
        ).scalar_one_or_none()

    # 3) 없으면 비밀번호 없는 소셜 전용 계정 신규 생성.
    #    인증되지 않은 이메일은 저장하지 않는다 — email_hash가 unique라, 같은 주소를 쓰는
    #    기존 계정이 있으면 삽입이 깨진다. 남의 주소를 적어 두고 나중에 그 계정을
    #    가로채는 발판이 되기도 한다.
    verified_email = profile.get("email") if profile.get("email_verified") else None
    if user is None:
        user = User(
            email=verified_email,
            email_hash=email_hash(verified_email) if verified_email else None,
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


async def complete_login(session: AsyncSession, provider: str, code: str, state: str) -> User:
    """콜백 처리: code → 토큰 → 프로필 → 사용자 찾거나 생성."""
    get_config(provider)  # 미지원 provider 방어
    try:
        access_token = await _exchange_code(provider, code, state)
        profile = await _fetch_profile(provider, access_token)
    except HTTPException:
        raise
    except httpx.HTTPError:
        logger.exception("소셜 로그인 provider 통신 실패 (%s)", provider)
        raise HTTPException(status_code=502, detail="소셜 로그인 제공자와 통신에 실패했어요.")
    return await _find_or_create_user(session, provider, profile)
