"""사용자 조건에 맞는 취업 지원 제도를 찾아 상담 화면 카드 문구를 만든다.

두 단계로 좁힌다.
1) 규칙 필터 — API 코드로 확실히 걸러낼 수 있는 것(연령·성별·대상특성·분야)
2) LLM 선별 — 코드에 없고 본문에만 있는 조건(직역·상황)은 규칙으로 못 거른다.
   실측상 규칙만 통과시키면 선원·산림직 같은 무관한 제도가 대량으로 섞여서,
   마지막 판단은 LLM에 맡기고 카드 문구까지 함께 만들게 한다.

키가 없거나 외부 API가 죽으면 None을 돌려준다 — 카드가 안 보일 뿐, 상담은 그대로 진행된다.
"""

from __future__ import annotations

import logging

from app.domains.policy import codes, providers
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 24  # LLM에 넘길 후보 상한 — 프롬프트가 너무 길어지지 않게
CARD_TIMEOUT_S = 12.0


def _clean_summary(text: str | None) -> str:
    """제도 설명을 한 줄로 정리한다.

    복지로 요약에는 '❍ ...\\n❍ ...' 같은 원문 서식이 그대로 들어 있다. 그대로 두면
    프롬프트에서는 잘릴 자리를 잡아먹고, 화면에서는 줄바꿈이 뭉개져 기호만 남는다.
    """
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip("❍○●・-*·∘ \t")
        if line:
            lines.append(line)
    return " ".join(lines)


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_employment(text: str) -> bool:
    return any(k in text for k in codes.EMPLOYMENT_KEYWORDS)


def _is_startup(text: str) -> bool:
    return any(k in text for k in codes.STARTUP_KEYWORDS)


def _off_topic(text: str) -> bool:
    return any(k in text for k in codes.OFF_TOPIC_KEYWORDS)


def _filter_gov24(
    services: dict[str, dict],
    conditions: list[dict],
    *,
    age: int | None,
    gender: str | None,
    has_disability: bool | None,
) -> list[dict]:
    """보조금24는 서버 필터가 없어(실측) 전량에서 우리가 골라낸다."""
    gender_key = codes.JA_GENDER_FEMALE if gender == "female" else codes.JA_GENDER_MALE
    picked = []
    for row in conditions:
        service = services.get(row.get("서비스ID"))
        if not service or service.get("서비스분야") != codes.FIELD_EMPLOYMENT:
            continue

        low, high = _as_int(row.get(codes.JA_AGE_MIN)), _as_int(row.get(codes.JA_AGE_MAX))
        if age is not None and low is not None and high is not None and not (low <= age <= high):
            continue
        if gender and row.get(gender_key) != "Y":
            continue

        # 해당하지 않는 특수 대상 전용 제도는 뺀다. 장애는 사용자가 해당하면 남긴다.
        blocked = False
        for code in codes.JA_SPECIAL_TARGETS:
            if row.get(code) != "Y":
                continue
            if code == codes.JA_DISABILITY and has_disability:
                continue
            blocked = True
            break
        if blocked:
            continue

        blob = f"{service.get('서비스명', '')} {service.get('서비스목적요약', '')}"
        if _is_startup(blob) or _off_topic(blob):
            continue

        picked.append(
            {
                "name": (service.get("서비스명") or "").strip(),
                "summary": _clean_summary(service.get("서비스목적요약")),
                "provider": service.get("소관기관명") or "",
                "link": service.get("상세조회URL") or "",
                "scope": "national",
            }
        )
    return picked


def _filter_bokjiro(rows: list[dict], *, ctpv: str | None, sgg: str | None) -> list[dict]:
    """복지로 결과를 거주지 기준으로 3단 정렬한다.

    지역을 하드 필터로 쓰지 않는다 — 다른 지역에서 일하려는 사람도 있어서,
    거주지 제도를 앞에 두되 전국 제도를 버리지는 않는다.
    """
    out = []
    for row in rows:
        blob = f"{row.get('name', '')} {row.get('summary', '')} {row.get('theme', '')}"
        if not _is_employment(blob) or _is_startup(blob) or _off_topic(blob):
            continue

        row_ctpv, row_sgg = row.get("ctpv") or "", row.get("sgg") or ""
        if row_ctpv and ctpv and row_ctpv != ctpv:
            continue  # 타 시도 전용 제도는 의미가 없다
        if row_sgg and sgg and row_sgg != sgg:
            continue  # 같은 시도라도 다른 시군구 전용이면 제외

        if row_sgg:
            scope, rank = "district", 0
        elif row_ctpv:
            scope, rank = "province", 1
        else:
            scope, rank = "national", 2

        out.append(
            {
                "name": row.get("name", ""),
                "summary": _clean_summary(row.get("summary")),
                "provider": row.get("provider", ""),
                "link": row.get("link", ""),
                "scope": scope,
                "_rank": rank,
            }
        )
    out.sort(key=lambda r: r.pop("_rank"))
    return out


async def collect_candidates(
    *,
    age: int | None,
    gender: str | None,
    has_disability: bool | None,
    ctpv: str | None,
    sgg: str | None,
) -> list[dict]:
    """조건에 맞는 제도 후보 — 거주지 우선, 중복 제거."""
    if not providers.is_configured():
        return []

    life_codes = codes.life_codes_for_age(age) if age is not None else ["004", "005"]
    target = codes.WELFARE_TARGET["장애인"] if has_disability else None

    local_rows, central_rows = [], []
    for life in life_codes:
        local_rows += await providers.bokjiro(providers.BOKJIRO_LOCAL, life=life, target=target)
        central_rows += await providers.bokjiro(
            providers.BOKJIRO_CENTRAL, life=life, target=target
        )

    services, conditions = await providers.gov24_snapshot()

    merged = (
        _filter_bokjiro(local_rows, ctpv=ctpv, sgg=sgg)
        + _filter_bokjiro(central_rows, ctpv=None, sgg=None)
        + _filter_gov24(
            services, conditions, age=age, gender=gender, has_disability=has_disability
        )
    )

    seen, unique = set(), []
    for row in merged:
        key = row["name"].strip()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique[:MAX_CANDIDATES]


def _cited_policies(body: str, candidates: list[dict]) -> list[dict]:
    """생성된 문구가 실제로 언급한 후보 제도들.

    LLM이 목록에 없는 제도명을 지어내면 사용자가 존재하지 않는 제도를 신청하러 간다.
    제도명이 길어 표기가 조금씩 달라질 수 있으므로(괄호·공백 차이) 공백을 지우고 비교하고,
    이름이 너무 짧은 항목은 우연히 겹칠 수 있어 제외한다.
    """
    flat = body.replace(" ", "")
    cited = []
    for row in candidates:
        name = (row.get("name") or "").strip()
        if len(name) < 4:
            continue
        if name.replace(" ", "") in flat:
            cited.append(row)
    return cited


async def build_card(
    *,
    age: int | None,
    gender: str | None,
    has_disability: bool | None,
    ctpv: str | None = None,
    sgg: str | None = None,
) -> dict | None:
    """상담 화면 '알고 계셨나요?' 카드. 후보가 없거나 생성 실패면 None(카드 미표시)."""
    candidates = await collect_candidates(
        age=age, gender=gender, has_disability=has_disability, ctpv=ctpv, sgg=sgg
    )
    if not candidates:
        return None

    system = render_prompt(
        "policy/card.md",
        age=age,
        gender={"male": "남성", "female": "여성"}.get(gender or ""),
        has_disability=has_disability,
        region=" ".join(x for x in (ctpv, sgg) if x) or None,
    )
    listing = "\n".join(
        f"- {c['name']} ({c['provider']}): {c['summary'][:120]}" for c in candidates
    )

    try:
        body = await get_llm().chat(
            [ChatMessage(role="user", content=listing)],
            system=system,
            temperature=0.4,
            # 한글은 토큰당 글자 수가 적어 320자 문단에도 여유가 필요하고,
            # thinking을 끄지 않으면 사고 토큰이 상한을 먹어 문장이 중간에 잘린다(실측).
            max_tokens=1200,
            thinking_budget=0,
        )
    except Exception:  # noqa: BLE001 — LLM 장애로 상담을 막지 않는다
        logger.warning("정책 카드 생성 실패 — 카드 생략", exc_info=True)
        return None

    body = body.strip()
    if not body:
        return None

    cited = _cited_policies(body, candidates)
    if not cited:
        # 후보 중 어느 것도 언급하지 않았다 = 근거 없는 문구이거나 제도명을 지어냈다는 뜻.
        # 정부 지원 제도는 사용자가 실제로 신청하러 가는 정보라, 확인 못 하면 안 내보낸다.
        logger.warning("정책 카드가 후보 제도를 인용하지 않음 — 카드 생략: %s", body[:80])
        return None
    # '더 알아보기'는 문구에서 실제로 언급한 제도로 보낸다 — 후보 1번으로 보내면
    # 본문과 다른 제도 페이지가 열려 사용자가 헷갈린다.
    return {
        "title": "잠깐, 혹시 이건 알고 계셨나요?",
        "body": body,
        "more_url": next(
            (c["link"] for c in cited if c.get("link")),
            "https://www.gov.kr/portal/rcvfvrSvc/main",
        ),
        # 카드에서 '더 알아보기'로 열리는 목록 — 본문이 실제로 언급한 제도만 담는다.
        "cited": [
            {
                "name": c["name"],
                "summary": c.get("summary", ""),
                "provider": c.get("provider", ""),
                "link": c.get("link", ""),
            }
            for c in cited
        ],
        "source_count": len(candidates),
    }
