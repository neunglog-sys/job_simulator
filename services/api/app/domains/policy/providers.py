"""정부 제도 API provider — 보조금24(gov24) · 복지로(중앙부처·지자체).

두 곳의 성격이 정반대라 호출 방식도 다르다.
- 복지로: 서버가 대상·생애주기 필터를 지원 → 조건을 그대로 넘겨 필요한 것만 받는다.
- 보조금24: 조건 파라미터를 **조용히 무시하고 전체를 반환**한다(실측 확인). 그래서 전량을
  받아 캐싱해 두고 우리가 필터링한다. 일 50만 쿼터라 11회 수집은 부담이 없다.

키가 없으면 빈 목록을 돌려준다 — 카드가 안 뜰 뿐 상담 흐름은 그대로 진행돼야 한다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import xml.etree.ElementTree as ET

import httpx

from app.core.config import settings
from app.core.redis import redis_client

logger = logging.getLogger(__name__)

GOV24_BASE = "https://api.odcloud.kr/api/gov24/v3"
BOKJIRO_CENTRAL = (
    "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"
)
BOKJIRO_LOCAL = (
    "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist"
)

_PAGE_SIZE = 1000
_TIMEOUT = 30.0
_CACHE_TTL_S = 60 * 60 * 24  # 제도 정보는 하루 단위로 바뀌어도 충분하다


def is_configured() -> bool:
    return bool(settings.data_go_kr_api_key)


async def _cached(key: str, loader):
    """Redis 캐시 래퍼 — 캐시가 죽어 있어도 원본 호출로 진행한다(카드가 사라지지 않게)."""
    cache_ok = True
    try:
        hit = await redis_client.get(key)
        if hit:
            return json.loads(hit)
    except Exception:  # noqa: BLE001 — 캐시 장애는 기능 중단 사유가 아니다
        logger.warning("정책 캐시 조회 실패 — 원본 호출로 진행", exc_info=True)
        cache_ok = False

    value = await loader()
    if cache_ok:
        try:
            await redis_client.set(key, json.dumps(value, ensure_ascii=False), ex=_CACHE_TTL_S)
        except Exception:  # noqa: BLE001
            logger.warning("정책 캐시 저장 실패", exc_info=True)
    return value


# ── 보조금24 ───────────────────────────────────────────────────────────────
async def _gov24_pages(path: str) -> list[dict]:
    """전량 수집. totalCount를 보고 필요한 페이지 수만 돈다."""
    headers = {"Authorization": f"Infuser {settings.data_go_kr_api_key}"}
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        first = await client.get(
            f"{GOV24_BASE}/{path}",
            params={"page": 1, "perPage": _PAGE_SIZE, "returnType": "JSON"},
            headers=headers,
        )
        first.raise_for_status()
        body = first.json()
        rows += body.get("data") or []
        total = int(body.get("totalCount") or 0)
        pages = -(-total // _PAGE_SIZE)

        for page in range(2, pages + 1):
            res = await client.get(
                f"{GOV24_BASE}/{path}",
                params={"page": page, "perPage": _PAGE_SIZE, "returnType": "JSON"},
                headers=headers,
            )
            res.raise_for_status()
            rows += res.json().get("data") or []
    return rows


async def gov24_snapshot() -> tuple[dict[str, dict], list[dict]]:
    """(서비스ID → 서비스정보, 지원조건 목록). 하루 1회 수집해 캐시한다."""
    if not is_configured():
        return {}, []

    async def load_services():
        return await _gov24_pages("serviceList")

    async def load_conditions():
        return await _gov24_pages("supportConditions")

    try:
        services, conditions = await asyncio.gather(
            _cached("policy:gov24:services", load_services),
            _cached("policy:gov24:conditions", load_conditions),
        )
    except Exception:  # noqa: BLE001 — 외부 장애 시 카드만 생략
        logger.warning("보조금24 수집 실패 — 건너뜀", exc_info=True)
        return {}, []
    return {s["서비스ID"]: s for s in services if s.get("서비스ID")}, conditions


# ── 복지로 ────────────────────────────────────────────────────────────────
def _parse_bokjiro(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for s in root.findall(".//servList"):
        def g(tag: str) -> str:
            el = s.find(tag)
            return (el.text or "").strip() if el is not None and el.text else ""

        out.append(
            {
                "id": g("servId"),
                "name": g("servNm"),
                "summary": g("servDgst"),
                "provider": g("jurMnofNm") or g("bizChrDeptNm"),
                "give": g("srvPvsnNm"),
                "link": g("servDtlLink"),
                "ctpv": g("ctpvNm"),
                "sgg": g("sggNm"),
                "theme": g("intrsThemaNmArray") or g("intrsThemaArray"),
                "target": g("trgterIndvdlNmArray") or g("trgterIndvdlArray"),
            }
        )
    return out


async def bokjiro(url: str, *, life: str, target: str | None) -> list[dict]:
    """복지로 목록 조회. callTp/srchKeyCode는 없으면 INVALID_REQUEST_PARAMETER_ERROR가 난다."""
    if not is_configured():
        return []
    params = {
        "serviceKey": settings.data_go_kr_api_key,
        "callTp": "L",
        "srchKeyCode": "001",
        "pageNo": 1,
        "numOfRows": _PAGE_SIZE,
        "lifeArray": life,
    }
    if target:
        params["trgterIndvdlArray"] = target

    cache_key = f"policy:bokjiro:{url.rsplit('/', 1)[-1]}:{life}:{target or '-'}"

    async def load():
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # data.go.kr 게이트웨이는 UA 없는 요청을 막는 경우가 있다.
            res = await client.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"})
            res.raise_for_status()
            return _parse_bokjiro(res.text)

    try:
        return await _cached(cache_key, load)
    except Exception:  # noqa: BLE001
        logger.warning("복지로 조회 실패 — 건너뜀 (%s)", cache_key, exc_info=True)
        return []
