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
from itertools import zip_longest

from app.domains.policy import codes, providers
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 24  # LLM에 넘길 후보 상한 — 프롬프트가 너무 길어지지 않게
# 장애 여부는 사용자가 민감정보 동의까지 하고 알려준 조건이다. 관련 제도가 있는데도
# 후보 상한에서 밀려 한 건도 안 실리면 카드가 그 조건을 무시한 것처럼 보인다.
DISABILITY_MIN_SLOTS = 8
CARD_TIMEOUT_S = 12.0
# 앞부분만으로 제도를 맞출 때 요구하는 최소 길이 — 짧은 이름이 우연히 겹치는 것을 막는다.
_MIN_PREFIX_MATCH = 6


def _squash(text: str | None) -> str:
    """제도명 비교용 — 표기 흔들림(공백·따옴표)을 지운다."""
    return "".join((text or "").split()).strip("'\"“”‘’")


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

        row_ctpv = codes.normalize_region(row.get("ctpv"))
        row_sgg = codes.normalize_region(row.get("sgg"))
        # 통합·개칭된 시도는 소스마다 표기가 달라, 같은 지역의 다른 이름끼리도 맞춰 준다.
        if row_ctpv and ctpv and row_ctpv not in codes.ctpv_aliases(ctpv):
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


def _filter_youth(
    rows: list[dict], *, age: int | None, ctpv: str | None, sgg: str | None
) -> list[dict]:
    """온통청년 정책을 연령·지역으로 좁힌다.

    분류는 서버에서 이미 '일자리 > 취업'으로 걸러져 있어 키워드 추측이 필요 없다.
    지역은 zipCd(시군구 코드 목록)로 판정한다 — 전국 정책은 전 지역 코드를 나열하므로
    시도 prefix 개수로 전국/지역을 가른다.
    """
    user_prefix = codes.YOUTH_CTPV_PREFIX.get(ctpv or "")
    out = []
    for row in rows:
        # sprtTrgtAgeLmtYn은 쓰지 않는다. 실측(2026-07-24)상 의미가 뒤집혀 있어서,
        # 'N'인 행에 오히려 유효한 연령대(15~34, 15~69)가 들어 있고 'Y'는 절반이 상한 0이다.
        # 플래그 대신 값이 실제로 채워졌을 때만 그 값으로 거른다.
        low, high = _as_int(row.get("sprtTrgtMinAge")), _as_int(row.get("sprtTrgtMaxAge"))
        if age is not None:
            if high and age > high:
                continue
            if low and age < low:
                continue

        zip_codes = [z.strip() for z in (row.get("zipCd") or "").split(",") if z.strip()]
        prefixes = {z[:2] for z in zip_codes}
        national = len(prefixes) >= codes.YOUTH_NATIONAL_MIN_PREFIXES

        if not national and user_prefix:
            if user_prefix not in prefixes:
                continue  # 다른 시도 전용
            mine = [z for z in zip_codes if z.startswith(user_prefix)]
            # 시군구 몇 곳만 지정한 정책은 그 지역 사람에게만 의미가 있는데, 사용자
            # 프로필엔 시군구 '이름'만 있고 코드가 없다. 정책명·기관명에 지역명이
            # 들어가는 표기 관행에 기대 확인한다(예: "(양주시) 청년…", "경기도 양주시 …").
            if len(mine) <= codes.YOUTH_DISTRICT_MAX_CODES and sgg:
                blob = " ".join(
                    str(row.get(k) or "")
                    for k in ("plcyNm", "sprvsnInstCdNm", "operInstCdNm", "rgtrInstCdNm")
                )
                if sgg not in blob:
                    continue

        summary = _clean_summary(row.get("plcyExplnCn")) or _clean_summary(row.get("plcySprtCn"))
        out.append(
            {
                "name": (row.get("plcyNm") or "").strip(),
                "summary": summary,
                "provider": (row.get("sprvsnInstCdNm") or row.get("operInstCdNm") or "").strip(),
                "link": (row.get("aplyUrlAddr") or row.get("refUrlAddr1") or "").strip(),
                "scope": "national" if national else "province",
                "_rank": 2 if national else 0,  # 거주지 정책을 앞에 둔다
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
    if not providers.is_configured() and not providers.youth_is_configured():
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
    youth_rows = await providers.youth_employment_policies()

    return _merge_and_cap(
        [
            _filter_youth(youth_rows, age=age, ctpv=ctpv, sgg=sgg),
            _filter_bokjiro(local_rows, ctpv=ctpv, sgg=sgg),
            _filter_bokjiro(central_rows, ctpv=None, sgg=None),
            _filter_gov24(
                services, conditions, age=age, gender=gender, has_disability=has_disability
            ),
        ],
        has_disability=has_disability,
    )


def _merge_and_cap(groups: list[list[dict]], *, has_disability: bool | None) -> list[dict]:
    """소스별 결과를 합쳐 후보 목록을 만든다.

    소스를 번갈아 뽑는다 — 한 소스가 다른 소스보다 훨씬 많은 결과를 내면(온통청년 126건 대
    복지로 13건) 앞에서부터 자르는 방식은 상한을 통째로 독차지해, 다른 소스에만 있는
    제도가 한 건도 안 실린다.
    """
    merged = []
    for tier in zip_longest(*groups):
        merged += [row for row in tier if row]

    seen, unique = set(), []
    for row in merged:
        key = row["name"].strip()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(row)

    if has_disability:
        related = [r for r in unique if "장애" in f"{r['name']} {r['summary']}"]
        if related:
            head = related[:DISABILITY_MIN_SLOTS]
            head_ids = {id(r) for r in head}
            unique = head + [r for r in unique if id(r) not in head_ids]

    return unique[:MAX_CANDIDATES]


def _split_output(raw: str) -> tuple[str, list[str]]:
    """LLM 출력을 '카드 문단'과 '더 알아보기 목록'으로 나눈다.

    구분자(---)가 없거나 목록이 비어 있어도 문단만 살려서 진행한다 — 목록은 부가 정보라,
    형식이 어긋났다고 카드 자체를 없앨 이유가 없다.
    """
    head, _, tail = (raw or "").partition("---")
    names = []
    for line in tail.splitlines():
        name = line.strip().lstrip("-•*").strip()
        if name:
            names.append(name)
    return head.strip(), names


def _named_policies(names: list[str], candidates: list[dict], exclude: list[dict]) -> list[dict]:
    """LLM이 고른 제도명을 후보와 대조해 실재하는 것만 남긴다.

    본문 인용과 같은 이유로 검증한다 — 지어낸 이름이 목록에 실리면 사용자가 존재하지 않는
    제도를 신청하러 간다. 이름이 아니라 후보 쪽 객체를 돌려주므로 링크·기관도 함께 간다.

    정확히 일치할 때만 인정하면 실제로는 거의 못 건진다(실측). 모델이 이름 뒤에 기관명을
    덧붙이거나('… (고용노동부)') 끝을 조금 흘려 쓰기 때문에, 괄호 앞부분으로 한 번 더
    맞춰 본다. 다만 후보가 둘 이상 걸리면 어느 쪽인지 확신할 수 없으므로 버린다.
    """
    taken = {c["name"] for c in exclude}
    pool = [(c, _squash(c["name"])) for c in candidates if c["name"] not in taken]

    picked, seen = [], set()
    for raw in names:
        key = _squash(raw)
        row = next((c for c, k in pool if k == key), None)
        if row is None:
            head = key.split("(")[0]
            if len(head) >= _MIN_PREFIX_MATCH:
                hits = [c for c, k in pool if k.startswith(head) or head.startswith(k)]
                row = hits[0] if len(hits) == 1 else None
        if row and row["name"] not in seen:
            seen.add(row["name"])
            picked.append(row)
    return picked


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
    # 제도명을 한 줄에 단독으로 둔다 — 이름 옆에 기관명을 붙여 두면 모델이 목록을 낼 때
    # '이름 (기관)' 형태를 그대로 따라 써서 후보와 대조가 안 된다(실측).
    listing = "\n".join(
        f"- {c['name']}\n  기관: {c['provider']} / 내용: {c['summary'][:120]}"
        for c in candidates
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

    body, extra_names = _split_output(body)
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
        # 카드 문단이 실제로 언급한 제도.
        "cited": [_policy_out(c) for c in cited],
        # '더 알아보기'에서 함께 보여줄 제도. 후보를 그대로 펼치지 않는다 — 규칙 필터만
        # 통과한 목록에는 취업과 무관한 것(돌봄·행정 발급·기업 지원 등)이 섞여 있어서,
        # 문단을 쓰면서 LLM이 함께 고른 것만 담고 이름을 후보와 대조해 검증한다.
        "more": [_policy_out(c) for c in _named_policies(extra_names, candidates, cited)],
        "source_count": len(candidates),
    }


def _policy_out(row: dict) -> dict:
    return {
        "name": row["name"],
        "summary": row.get("summary", ""),
        "provider": row.get("provider", ""),
        "link": row.get("link", ""),
    }
