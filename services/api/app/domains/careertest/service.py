"""커리어넷 진로심리검사 프록시 (Open API).

확인된 검사 목록 중 성인 대상은 **직업가치관검사(검사번호 6, 대학생/일반용)** 하나뿐
(나머지 검사는 전부 초중고생 대상) — 그래서 이 검사만 고정으로 쓴다.
CAREERNET_API_KEY 없으면 라우터가 503으로 응답(OAuth·아바타와 동일한 미설정 패턴).
"""

import httpx

from app.core.config import settings

BASE_URL = "https://www.career.go.kr/inspct/openapi/test"
TEST_NO = 6  # 직업가치관검사 — 대학생/일반


class CareerNetError(RuntimeError):
    """커리어넷이 HTTP 200 + SUCC_YN=N으로 실패를 알릴 때 (인증키 오류·쿼터 초과 등)."""


def is_configured() -> bool:
    return bool(settings.careernet_api_key)


def _check_succ(data: dict) -> dict:
    # 실측 확인: 실패도 HTTP 200으로 오고 본문의 SUCC_YN으로만 구분된다 —
    # raise_for_status()로는 절대 안 걸림.
    if data.get("SUCC_YN") == "N":
        raise CareerNetError(data.get("ERROR_REASON") or "커리어넷 API가 실패를 반환했어요.")
    return data


async def fetch_questions() -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            f"{BASE_URL}/questions",
            params={"apikey": settings.careernet_api_key, "q": TEST_NO},
        )
        res.raise_for_status()
        return _check_succ(res.json())


async def submit_report(
    answers: list[dict],
    trget_se: str = "100209",  # 100208=대학생, 100209=일반
    gender: str | None = None,
    grade: str | None = None,
    start_dtm: str | None = None,
) -> dict:
    body = {
        "apikey": settings.careernet_api_key,
        "qestrnSeq": TEST_NO,
        "trgetSe": trget_se,
        "answers": answers,
    }
    # None을 그대로 보내지 않는다 — 이런 정부 API들은 널값 필드에 엄격히 실패하는
    # 경우가 흔해서, 값이 있을 때만 키를 채운다.
    if gender is not None:
        body["gender"] = gender
    if grade is not None:
        body["grade"] = grade
    if start_dtm is not None:
        body["startDtm"] = start_dtm

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(f"{BASE_URL}/report", json=body)
        res.raise_for_status()
        return _check_succ(res.json())
