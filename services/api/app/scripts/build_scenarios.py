"""조사자료(team_*) → 게임 시나리오 변환 (하루 일과형 + 돌발 퀘스트).

팀 확정 구조:
  스텝 1~4 = 일과 미션 (대표미션으로 뽑힌 유형 제외한 나머지, 상황유형 순서)
  돌발 퀘스트 = 대표미션 (스텝 전환 시 확률 발동)
  NPC ≥ 3명 = 아키타입 규칙(사수·상사·응대상대) + 조사 npc_roles에서 조립

사용: docker compose exec api python -m app.scripts.build_scenarios
방식: scenarios·jobs·npc_personas 업서트 (멱등). data/scenarios/*.yaml이 소유한
      slug는 건너뜀 — 사람 검수본이 항상 우선.
"""

import asyncio
import logging
import random
import re
import sys
from pathlib import Path

import yaml
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import validate_scenario, yaml_scenario_slugs
from app.core.config import settings
from app.domains.scoring.aggregate import TYPE_COMPETENCY
from app.models import (
    Job,
    Npc,
    NpcPlacement,
    Scenario,
    TeamCategory,
    TeamMission,
    TeamRepMission,
)

logger = logging.getLogger(__name__)

# 일과 미션의 표준 순서 (기승전결 난이도 곡선) — 역량 매핑(aggregate)과 단일 소스
TYPE_ORDER = list(TYPE_COMPETENCY)

# 모듈 공통 시작 상태값 — npc 프롬프트 템플릿이 참조하는 3개 키 고정
INITIAL_STATE = {"trust": 50, "schedule_stability": 70, "requirement_clarity": 20}

# ── NPC 아키타입 (역할 키워드 분류 → 성격·선호·불호·말버릇 재료) ───────────
# system_prompt 통짜 대신 '재료' 배열만 — 완성 프롬프트는 코드 템플릿(npc/system.md)이 조립.
ARCHETYPES = {
    "mentor": {
        "keywords": ["사수", "선임", "수석", "시니어", "반장", "주임", "베테랑", "지도", "기장"],
        "personality": ["경험 많고 실무에 밝다", "차분하고 원칙적", "후배를 챙기되 답을 대신 정해주지 않는다"],
        "likes": ["구체적으로 파고드는 질문", "스스로 고민한 흔적"],
        "dislikes": ["고민 없이 결정부터 하는 태도", "정답만 떠먹여 달라는 요구"],
        "speech_habits": ["그렇게 하면 어떻게 될 것 같아요?", "핵심부터 봅시다."],
        "fallback_role": "선임 사수",
    },
    "supervisor": {
        "keywords": ["팀장", "과장", "부장", "점장", "지점장", "소장", "원장", "센터장",
                     "실장", "매니저", "지휘관", "당직", "기관장", "책임", "차장", "관제"],
        "personality": ["승인·보고를 받는 책임자", "꼼꼼하고 근거를 요구한다", "형식을 갖춘 보고엔 협조적"],
        "likes": ["사실·근거·다음 조치가 갖춰진 보고", "우선순위 기준이 분명한 판단"],
        "dislikes": ["두루뭉술한 보고", "확인 없는 단정"],
        "speech_habits": ["근거가 뭐예요?", "우선순위 기준은요?"],
        "fallback_role": "담당 팀장",
    },
    "counterpart": {
        "keywords": ["고객", "환자", "민원", "회원", "승객", "학부모", "보호자", "투숙객",
                     "이용자", "의뢰", "차주", "임차인", "구매", "손님", "시민", "주민"],
        "personality": ["응대 대상", "자기 요구와 상황은 잘 알지만 내부 절차는 모른다", "응대 태도에 민감"],
        "likes": ["성의 있고 공감하는 응대", "쉬운 말로 풀어주는 설명"],
        "dislikes": ["절차만 따지는 태도", "성의 없는 응대"],
        "speech_habits": ["아니 그게 무슨 말이에요?", "빨리 좀 처리해줘요."],
        "fallback_role": "방문 고객",
    },
    "colleague": {  # 분류 실패 시 기본값
        "keywords": [],
        "personality": ["협업 부서 담당자", "자기 영역 정보를 갖고 있다", "요청이 명확하면 협조적"],
        "likes": ["명확한 요청", "필요한 것이 특정된 협조 요청"],
        "dislikes": ["애매한 요청", "떠넘기는 태도"],
        "speech_habits": ["정확히 뭐가 필요하세요?", "그건 제 담당은 아닌데, 확인해볼게요."],
        "fallback_role": "협업 담당자",
    },
}

# ── 원본 NPC 문자열 파싱 (이름/역할/직급 분리) ──────────────────────────
SURNAMES = set("김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구원태")
RANK_KEYWORDS = ["팀장", "지점장", "센터장", "점장", "소장", "원장", "실장", "부장", "과장", "차장",
                 "대리", "반장", "주임", "선임", "수석", "매니저", "기관사", "관제사", "정비원",
                 "요원", "형사", "경위", "경사", "순경"]
# 성씨로 시작하지만 인명이 아닌 역할어 (오탐 방지)
NAME_STOPWORDS = {"고령", "초보", "급한", "만취", "외국인", "신규", "기존", "블랙컨슈머", "의뢰부서",
                  "기록관리자", "전문자격자", "전문", "담당", "타부서", "회계담당",
                  "고객", "손님", "환자", "승객", "회원", "주민", "시민", "차주", "학생",
                  "민원", "이용자", "투숙객", "보호자", "학부모", "의뢰인"}


def split_npc_list(raw: str | None) -> list[str]:
    """콤마로 NPC를 분리하되 괄호 안 콤마는 무시 — '정미래 안전관리자(…, 야간)'가 쪼개지던 버그 방지."""
    out, depth, cur = [], 0, ""
    for ch in raw or "":
        if ch in "(（":
            depth += 1
        elif ch in ")）":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return [x.strip() for x in out if x.strip()]


def norm_role(raw: str) -> str:
    """NPC 문자열에서 괄호 설명 제거 — 원본→매칭 키 정규화 (표시·참조 양쪽 동일)."""
    return re.sub(r"\(.*?\)", "", raw or "").strip()


_match_key = norm_role  # 원본 NPC 문자열 → 로스터 매칭 키 (괄호 무시)


def _looks_like_name(tok: str) -> bool:
    if not (re.fullmatch(r"[가-힣]{2,3}", tok) and tok[0] in SURNAMES and tok not in NAME_STOPWORDS):
        return False
    return not any(tok.endswith(r) for r in RANK_KEYWORDS)  # '박팀장'=성씨+직급 → 인명 아님


def parse_npc(raw: str) -> tuple[str, str, str]:
    """원본 NPC 문자열 → (name, role, rank).

    '김민석 팀장(경위, 지구대 순찰팀장)' → ('김민석', '지구대 순찰팀장', '팀장')
    '원무팀장'                          → ('원무팀장', '원무팀장', '팀장')  # 인명 없는 역할 라벨
    """
    raw = raw.strip()
    head = raw.split("(", 1)[0].strip() if "(" in raw else raw
    paren = raw.split("(", 1)[1].rstrip("） )").strip() if "(" in raw else ""
    tokens = head.split()

    name, rest = head, head
    if len(tokens) >= 2 and _looks_like_name(tokens[0]):
        name, rest = tokens[0], " ".join(tokens[1:])

    rank = next((r for r in RANK_KEYWORDS if r in head), "")
    # 역할: 괄호 설명 중 가장 서술적인(긴) 조각을 우선 — 첫 조각은 직급인 경우가 많음
    # ('경위, 지구대 순찰팀장' → '지구대 순찰팀장'). 괄호 없으면 이름 뗀 나머지, 그것도 없으면 라벨
    role = max((p.strip() for p in paren.split(",")), key=len) if paren else (rest or head)
    return name, role.strip(), rank


def classify(raw: str) -> str:
    for key in ("supervisor", "mentor", "counterpart"):  # 직급 키워드 우선 ('고객지원 팀장'=상사)
        if any(k in raw for k in ARCHETYPES[key]["keywords"]):
            return key
    return "colleague"


def make_npc_id(slug: str, idx: int) -> str:
    return f"npc_{slug}_{idx:02d}"


# ── 인명 생성 (역할 라벨 NPC에 사람 이름 부여 — 팀장 승인, 재방출 시 결정적) ──
_GEN_SURNAMES = list("김이박최정강조윤장임한오서신권황안송전홍유고문양손배백")
_GEN_GIVEN = ["서준", "도윤", "하준", "지호", "예준", "시우", "하윤", "서연", "지우", "서현",
              "지훈", "현우", "우진", "건우", "선우", "연우", "유진", "수아", "지아", "다은",
              "채원", "가은", "윤서", "은채", "소율", "예린", "하은", "주원", "은호", "정우",
              "민서", "수빈", "예은", "지민", "현서", "도현", "태오", "시윤", "하린", "지안"]
# 이스터에그 — 각 담당의 첫 시나리오 대표 NPC(사수 우선)에 팀원 이름을 한 번씩
EASTER_EGG = {"kts-01": "김태수", "ms-01": "모세종", "stn-01": "송태능",
              "yg-01": "윤가연", "ys-01": "최영수", "jm-01": "장민수"}


def gen_name(seed: str, used: set[str]) -> str:
    """역할 라벨 NPC용 사람 이름 결정적 생성 — 같은 npc_id면 재방출해도 동일, 시나리오 내 유일."""
    rng = random.Random(f"{seed}-name")
    for _ in range(80):
        n = rng.choice(_GEN_SURNAMES) + rng.choice(_GEN_GIVEN)
        if n not in used:
            used.add(n)
            return n
    n = rng.choice(_GEN_SURNAMES) + rng.choice(_GEN_GIVEN) + str(len(used) + 1)
    used.add(n)
    return n


def build_npc(raw: str, slug: str, idx: int, used_names: set[str]) -> dict:
    """원본 NPC 문자열 → 정규화 NPC 엔트리 (고유정보 + 배치정보 통합, seed가 두 테이블로 분리).

    인명이 없는 역할 라벨('원무팀장' 등)은 사람 이름을 생성하고 라벨을 role로 보존한다.
    responsibilities·appearance는 상위(build_scenario_doc)에서 등장 스텝을 알고 채운다.
    """
    name, role, rank = parse_npc(raw)
    npc_id = make_npc_id(slug, idx)
    # 첫 토큰이 사람 이름이 아니면(역할 라벨) 이름 생성, 라벨(name=head)을 역할로
    if not _looks_like_name(name.split()[0] if name else ""):
        role = name or role  # 원무팀장/고령 환자 등 라벨을 역할로
        name = gen_name(npc_id, used_names)
    else:
        used_names.add(name)
    arch = ARCHETYPES[classify(raw)]
    return {
        "npc_id": npc_id,
        "name": name,
        "role": role,
        "rank": rank or None,
        "personality": list(arch["personality"]),
        "likes": list(arch["likes"]),
        "dislikes": list(arch["dislikes"]),
        "speech_habits": list(arch["speech_habits"]),
        "responsibilities": [],   # build_scenario_doc에서 등장 스텝 미션으로 채움
        "appearance": {},         # build_scenario_doc에서 available_steps 채움
        "_arch": classify(raw),   # 폴백 보충 판단용 (emit 전 제거)
    }


def split_criteria(success: str | None, failure: str | None) -> list[str]:
    """성공기준 문장 → 채점 criteria 목록 (쉼표 분리, 2~5개). 서술형(write) 과제 전용."""
    items = [c.strip() for c in (success or "").split(",") if c.strip()][:4]
    if not items:
        items = ["미션 요구사항을 충족했는가"]
    if failure:  # 실패패턴 기준은 잘리지 않게 마지막에 보장 삽입
        items.append(f"흔한 실수를 피했는가 ({failure[:80]})")
    return items


def slug_for(missions: list[TeamMission], category_no: int, owner: str | None) -> str:
    """mission_code 접두(KTS-01 등)를 slug로 — 없으면 담당자 이니셜+번호."""
    for m in missions:
        match = re.match(r"^([A-Za-z]+-\d+)", m.mission_code or "")
        if match:
            return match.group(1).lower()
    prefix = re.sub(r"[^a-z]", "", (owner or "team").lower()) or "team"
    return f"{prefix}-{category_no:02d}"


def mission_npcs(raw: str | None) -> list[str]:
    """미션 NPC 필드 파싱 — 괄호 인식 분리 + 정규화 (괄호 안 콤마로 안 쪼개짐)."""
    return [norm_role(r) for r in split_npc_list(raw) if norm_role(r)]


# ── 라이트 메커니즘 조립 (팀장 방침: 사용자에게 문서 작성을 시키지 않는다) ──
# 조사 시트의 구현형태(impl_form) 의도를 상황유형별 인터랙션으로 구현:
#   정상업무        체크리스트+선택   → checklist (필요한 행동 모두 고르기)
#   자료·정보 누락  오류탐지+질문     → choice    (문제 있는 행동 골라내기)
#   우선순위 충돌   우선순위 배열+보고 → order     (올바른 순서로 배열)
#   오류·안전위험   돌발대응 분기     → choice    (첫 대응 고르기)
#   보고·인계       요약작성+AI 대화  → write     (유일한 서술형 — 짧은 인계 보고)
# 정답 = 행동순서(action_steps), 오답 = 실패패턴(failure_patterns) — 전부 조사 데이터 조립,
# 데이터가 모자라면 write로 폴백 (진행이 막히는 것보다 서술형이 낫다).

CIRCLED_RE = re.compile(r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]")
ORDER_ITEM_CAP = 4  # 배열 항목 수 상한 — 라이트하게


def split_action_steps(raw: str | None) -> list[str]:
    """'① A ② B ...' → ["A", "B", ...]. 원문자 마커가 없으면 빈 목록 (write 폴백 신호)."""
    if not raw or not CIRCLED_RE.search(raw):
        return []
    return [p.strip(" ·,;") for p in CIRCLED_RE.split(raw) if p.strip(" ·,;")]


def split_failures(raw: str | None) -> list[str]:
    return [p.strip() for p in (raw or "").split(",") if p.strip()]


def _make_options(entries: list[tuple[str, str]], seed: str) -> tuple[list[dict], dict]:
    """(label, tag) 목록 → 결정적 셔플 후 key 부여. → (options, tag별 key 목록).

    셔플 시드는 mission_code — 재변환해도 보기 순서가 흔들리지 않게 (멱등).
    """
    shuffled = list(entries)
    random.Random(seed).shuffle(shuffled)
    options, by_tag = [], {}
    for i, (label, tag) in enumerate(shuffled):
        key = chr(ord("a") + i)
        options.append({"key": key, "label": label})
        by_tag.setdefault(tag, []).append(key)
    return options, by_tag


def _base_task(m: TeamMission, kind: str, prompt: str, criteria: list[str]) -> dict:
    return {
        "kind": kind,
        "prompt": prompt,
        "criteria": criteria,
        "pass_score": 70,
        "hints": {
            "warning": (m.failure_patterns or "")[:200] or None,
            "answer_guide": m.action_steps,  # 3차 힌트 = 정답 골격 공개 (팀 결정)
        },
        # on_pass는 조립 후 체인 연결
    }


def build_task(m: TeamMission) -> dict:
    """미션 1건 → 과제. 상황유형별 라이트 메커니즘, 데이터 부족 시 write 폴백."""
    steps = split_action_steps(m.action_steps)
    fails = split_failures(m.failure_patterns)
    seed = m.mission_code or (m.mission or "")[:40]
    # 보기 문구 중복은 정답 판별을 깨므로 제거 (동일 문구가 정답·오답 양쪽에 오는 경우 방지)
    fails = [f for f in fails if f not in set(steps)]
    situation = m.situation_type or ""

    if situation == "정상업무" and len(steps) >= 2 and fails:
        entries = [(s, "o") for s in steps[:5]] + [(f, "x") for f in fails[:2]]
        options, by_tag = _make_options(entries, seed)
        task = _base_task(
            m, "checklist",
            f"{m.mission}\n\n아래 보기에서 이 업무에 필요한 행동을 모두 선택하세요.",
            ["필요한 행동을 빠짐없이 골랐는가"],
        )
        return {**task, "options": options, "answer": {"keys": by_tag["o"]}}

    if situation == "자료·정보 누락" and len(steps) >= 2 and fails:
        entries = [(s, "o") for s in steps[:3]] + [(fails[0], "x")]
        options, by_tag = _make_options(entries, seed)
        task = _base_task(
            m, "choice",
            f"{m.mission}\n\n아래 행동 중 문제가 있는 것 하나를 골라내세요.",
            ["문제 있는 행동을 정확히 찾아냈는가"],
        )
        return {**task, "options": options, "answer": {"key": by_tag["x"][0]}}

    if situation == "우선순위 충돌" and len(steps) >= 3:
        items = steps[:ORDER_ITEM_CAP]
        if len(set(items)) == len(items):  # 중복 문구면 순서 정답이 모호 — write 폴백
            entries = [(s, str(i)) for i, s in enumerate(items)]
            options, by_tag = _make_options(entries, seed)
            answer = [by_tag[str(i)][0] for i in range(len(items))]
            if [o["key"] for o in options] == answer:  # 셔플 결과가 정답 순서면 정답 유출 — 한 칸 회전
                options = options[1:] + options[:1]
            task = _base_task(
                m, "order",
                f"{m.mission}\n\n아래 항목을 올바른 처리 순서대로 배열해 제출하세요.",
                ["업무 처리 순서를 올바르게 판단했는가"],
            )
            return {**task, "options": options, "answer": {"keys": answer}}

    if situation == "오류·안전위험" and steps and len(fails) + len(steps) - 1 >= 2:
        wrong = fails[:2] + steps[1:]  # 오답: 실패패턴 우선, 모자라면 '나중 단계' (첫 대응으론 오답)
        entries = [(steps[0], "o")] + [(w, "x") for w in wrong[:3]]
        options, by_tag = _make_options(entries, seed)
        task = _base_task(
            m, "choice",
            f"{m.mission}\n\n아래 보기 중 지금 가장 먼저 해야 할 대응을 하나 고르세요.",
            ["가장 먼저 할 대응을 올바르게 판단했는가"],
        )
        return {**task, "options": options, "answer": {"key": by_tag["o"][0]}}

    # 보고·인계 + 데이터 부족 폴백 — 유일한 서술형 (짧은 보고)
    task = _base_task(
        m, "write",
        f"{m.mission}\n\n제출 산출물: {m.outputs}" if m.outputs else (m.mission or ""),
        split_criteria(m.success_criteria, m.failure_patterns),
    )
    return task


def _short_duty(mission: str | None) -> str:
    """미션 문장 → 담당업무 한 줄 (첫 절, 40자)."""
    text = re.split(r"[.\n]", mission or "")[0].strip()
    return text[:40]


def mission_to_step(m: TeamMission, step_id: str, npc_by_key: dict) -> dict:
    """미션 1건 → 스텝. npcs는 npc_id 목록(이름 아님) — npc_by_key로 원본→npc 매핑."""
    ids, first_name = [], ""
    for raw in split_npc_list(m.npc):
        e = npc_by_key.get(_match_key(raw))
        if e and e["npc_id"] not in ids:
            ids.append(e["npc_id"])
            first_name = first_name or e["name"]
    return {
        "id": step_id,
        "type": m.situation_type,
        "title": m.situation_type or "업무 미션",
        "mission": (
            f'{first_name}: "{m.npc_line}"\n\n{m.mission}'
            if (m.npc_line and first_name) else (m.mission or "")
        ),
        "npcs": ids,
        "guide": f"제공 자료: {m.materials}" if m.materials else None,
        "task": build_task(m),
    }


def build_scenario_doc(
    category: TeamCategory, missions: list[TeamMission], rep_codes: set[str], slug: str
) -> dict | None:
    """중분류 1개 → 시나리오 문서 (NPC 정규화: npc_id 참조 + 고유/배치 필드). 미션 부족은 None."""
    if not missions:
        logger.warning("스킵 %s: 미션 없음", category.category)
        return None

    rep = [m for m in missions if m.mission_code in rep_codes]
    daily = [m for m in missions if m.mission_code not in rep_codes]
    if len(daily) < 2:  # 스텝 2개 미만이면 퀘스트 발동 불가 — rep를 본편 스텝으로 유지 (소실 방지)
        daily, rep = missions, []

    order = {t: i for i, t in enumerate(TYPE_ORDER)}
    daily.sort(key=lambda m: order.get(m.situation_type, 99))

    # ── NPC 로스터: category.npc_roles + 모든 미션 NPC (괄호 인식 분리, 원본 dedup) ──
    npc_by_key: dict[str, dict] = {}
    roster: list[dict] = []
    used_names: set[str] = set()  # 시나리오 내 이름 중복 방지 (생성 인명)
    for raw in split_npc_list(category.npc_roles) + [r for m in missions for r in split_npc_list(m.npc)]:
        key = _match_key(raw)
        if not key or key in npc_by_key:
            continue
        entry = build_npc(raw, slug, len(roster) + 1, used_names)
        npc_by_key[key] = entry
        roster.append(entry)
    # 최소 3명 보장 — 빠진 아키타입 축을 기본 역할로 보충 (근거 없는 실존 NPC 창작은 아님)
    seen_arch = {e["_arch"] for e in roster}
    for arch_key in ("mentor", "supervisor", "counterpart"):
        if len(roster) >= 3:
            break
        if arch_key not in seen_arch:
            entry = build_npc(ARCHETYPES[arch_key]["fallback_role"], slug, len(roster) + 1, used_names)
            npc_by_key[_match_key(ARCHETYPES[arch_key]["fallback_role"])] = entry
            roster.append(entry)

    # 이스터에그 — 각 담당 첫 시나리오의 사수(mentor) NPC에 팀원 이름 (없으면 첫 NPC)
    if slug in EASTER_EGG:
        target = next((e for e in roster if e["_arch"] == "mentor"), roster[0])
        target["name"] = EASTER_EGG[slug]

    steps = [mission_to_step(m, f"m{i}", npc_by_key) for i, m in enumerate(daily, 1)]
    for i, step in enumerate(steps):
        step["task"]["on_pass"] = steps[i + 1]["id"] if i + 1 < len(steps) else "__end__"
        if not step["npcs"]:  # 매칭 실패 시 첫 NPC로 보정 (스텝은 반드시 대화 상대 필요)
            step["npcs"] = [roster[0]["npc_id"]]

    step_mission = {f"m{i}": m for i, m in enumerate(daily, 1)}
    quest = None
    if rep and len(steps) >= 2:  # 스텝 1개면 전환이 없어 발동 불가 — 퀘스트 생략
        q = rep[0]
        q_ids = mission_to_step(q, "quest", npc_by_key)["npcs"]
        q_npc = q_ids[0] if q_ids else roster[0]["npc_id"]
        q_name = next((e["name"] for e in roster if e["npc_id"] == q_npc), "")
        quest = {
            "npc": q_npc,
            "intro": f'{q_name}이(가) 다급하게 찾아왔다. "{q.npc_line}"' if q.npc_line
                     else "예상치 못한 상황이 발생했다.",
            "task": {**build_task(q), "type": q.situation_type},
        }
        step_mission["quest"] = q

    # 담당업무·등장 채우기 — NPC가 등장하는 스텝의 미션에서 파생
    appears: dict[str, list[str]] = {}
    for step in steps:
        for nid in step["npcs"]:
            appears.setdefault(nid, []).append(step["id"])
    if quest:
        appears.setdefault(quest["npc"], []).append("quest")
    for e in roster:
        step_ids = appears.get(e["npc_id"], [])
        duties = [_short_duty(step_mission[s].mission) for s in step_ids if s in step_mission]
        e["responsibilities"] = list(dict.fromkeys(d for d in duties if d))[:4]
        e["appearance"] = {"location": None, "available_steps": step_ids}
        if quest and e["npc_id"] == quest["npc"]:
            e["appearance"]["conditions"] = ["quest_started"]
        e.pop("_arch", None)

    return {
        "job": None,   # main()에서 slug로 설정
        "slug": slug,
        "title": f"{category.category} — 신입의 하루",
        "module": category.module,
        "initial_state": dict(INITIAL_STATE),
        "steps": steps,
        "sudden_quest": quest,
        "npcs": roster,
    }


async def upsert_scenario(
    session: AsyncSession, doc: dict, job_code: str, job_title: str, description: str
) -> None:
    job_stmt = insert(Job).values(
        code=job_code,
        title=job_title,
        description=(description or "")[:2000],
        competencies={},
    ).on_conflict_do_update(
        index_elements=[Job.code],
        set_={"title": job_title},
    )
    await session.execute(job_stmt)
    job_id = (
        await session.execute(select(Job.id).where(Job.code == job_code))
    ).scalar_one()

    stmt = insert(Scenario).values(
        job_id=job_id,
        slug=doc["slug"],
        title=doc["title"],
        module=doc["module"],
        initial_state=doc["initial_state"],
        steps=doc["steps"],
        sudden_quest=doc["sudden_quest"],
    ).on_conflict_do_update(
        index_elements=[Scenario.slug],
        set_={
            "job_id": job_id,
            "title": doc["title"],
            "module": doc["module"],
            "initial_state": doc["initial_state"],
            "steps": doc["steps"],
            "sudden_quest": doc["sudden_quest"],
        },
    )
    await session.execute(stmt)
    scenario_id = (
        await session.execute(select(Scenario.id).where(Scenario.slug == doc["slug"]))
    ).scalar_one()

    # NPC는 통째로 교체 (변환본은 항상 최신 조사 기준). 고유정보=npcs, 배치정보=npc_placements.
    await session.execute(
        delete(NpcPlacement).where(NpcPlacement.scenario_id == scenario_id)
    )
    for p in doc["npcs"]:
        await session.execute(
            insert(Npc).values(
                npc_id=p["npc_id"], name=p["name"],
                personality=p["personality"], likes=p["likes"],
                dislikes=p["dislikes"], speech_habits=p["speech_habits"],
            ).on_conflict_do_update(
                index_elements=[Npc.npc_id],
                set_={"name": p["name"], "personality": p["personality"],
                      "likes": p["likes"], "dislikes": p["dislikes"],
                      "speech_habits": p["speech_habits"]},
            )
        )
        session.add(NpcPlacement(
            scenario_id=scenario_id, npc_id=p["npc_id"], role=p["role"],
            rank=p.get("rank"), responsibilities=p["responsibilities"],
            appearance=p["appearance"],
        ))


async def build_all_docs(session: AsyncSession) -> list[tuple[TeamCategory, dict]]:
    """모든 팀 중분류 → (category, doc) 목록. slug·job 배정과 충돌·구조 검증 완료.

    DB 적재(main)와 YAML 방출(emit_yaml)이 공유하는 단일 문서 생성 경로.
    """
    categories = list(
        (await session.execute(select(TeamCategory).order_by(TeamCategory.id))).scalars()
    )
    rep_codes = set(
        (await session.execute(select(TeamRepMission.mission_code))).scalars()
    )
    used_slugs: dict[str, str] = {}
    docs: list[tuple[TeamCategory, dict]] = []
    for cat in categories:
        missions = list(
            (
                await session.execute(
                    select(TeamMission)
                    .where(TeamMission.category == cat.category)
                    .order_by(TeamMission.id)
                )
            ).scalars()
        )
        slug = slug_for(missions, cat.no or cat.id, cat.owner)  # npc_id 생성에 필요 — 먼저 계산
        if slug in used_slugs:  # 조용한 덮어쓰기 방지 — 데이터 문제를 즉시 드러냄
            raise ValueError(f"slug 충돌: '{slug}' ← {cat.category} vs {used_slugs[slug]}")
        used_slugs[slug] = cat.category
        doc = build_scenario_doc(cat, missions, rep_codes, slug)
        if doc is None:
            continue
        doc["job"] = doc["slug"]  # 변환 시나리오의 job 코드 = slug
        validate_scenario(doc, f"변환:{cat.category}")
        docs.append((cat, doc))
    return docs


async def main() -> None:
    from app.core.db import SessionFactory

    protected = yaml_scenario_slugs()  # 사람 검수 YAML이 소유한 slug는 건드리지 않음
    built = skipped = 0
    async with SessionFactory() as session:
        for cat, doc in await build_all_docs(session):
            if doc["slug"] in protected:
                logger.info("스킵 %s: 검수 YAML(%s)이 우선", cat.category, doc["slug"])
                skipped += 1
                continue
            await upsert_scenario(
                session, doc,
                job_code=doc["slug"], job_title=cat.category, description=cat.work_flow,
            )
            built += 1
        await session.commit()

    print(f"시나리오 변환 완료: 생성/갱신 {built}건, 스킵 {skipped}건 (검수 YAML 보호 포함)")


# ── YAML 방출 (커밋·검수용 소스 파일 생성) ────────────────────────────
AUTO_GEN_MARKER = "# AUTO-GENERATED by build_scenarios emit"
_AUTO_GEN_HEADER = (
    f"{AUTO_GEN_MARKER} — 조사 데이터(team_*)에서 자동 생성.\n"
    "# 손으로 편집하려면 위 줄을 지우세요 — 그러면 재생성에서 이 파일을 보호합니다.\n"
)


class _BlockDumper(yaml.SafeDumper):
    """여러 줄 문자열은 리터럴 블록(|)으로 — 사람이 읽고 편집하기 좋게."""


def _str_representer(dumper: yaml.Dumper, data: str):
    style = "|" if "\n" in data.strip() else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


_BlockDumper.add_representer(str, _str_representer)


def _dump_yaml(doc: dict) -> str:
    return yaml.dump(
        doc, Dumper=_BlockDumper, allow_unicode=True, sort_keys=False,
        default_flow_style=False, width=100,
    )


def _write_protected(write_path: Path, body: str, check_path: Path | None = None) -> bool:
    """마커가 있는(=자동 생성) 파일만 덮어씀. 손편집·미표시 파일은 보호. → 썼으면 True.

    check_path: 손편집 여부를 확인할 기존 파일 위치 (컨테이너 data/가 읽기전용이라
    쓰기는 write_path(임시)로, 검사는 실제 data/의 check_path로 분리 가능).
    """
    check = check_path or write_path
    if check.exists() and AUTO_GEN_MARKER not in check.read_text(encoding="utf-8"):
        logger.warning("보호: %s 는 손편집본 — 건너뜀", check.name)
        return False
    write_path.write_text(_AUTO_GEN_HEADER + body, encoding="utf-8")
    return True


def scenario_to_yaml_doc(doc: dict) -> dict:
    """내부 doc → data/scenarios YAML 키 순서 (loader REQUIRED_SCENARIO_KEYS 정합)."""
    return {
        "job": doc["job"],
        "slug": doc["slug"],
        "title": doc["title"],
        "module": doc["module"],
        "initial_state": doc["initial_state"],
        "steps": doc["steps"],
        "sudden_quest": doc["sudden_quest"],
        "npcs": doc["npcs"],
    }


def job_to_yaml_doc(cat: TeamCategory, slug: str) -> dict:
    """시나리오가 참조할 최소 직무 문서 — 신규 배포 seed가 job FK를 찾게."""
    return {
        "code": slug,
        "title": cat.category,
        "description": (cat.work_flow or cat.category or "")[:2000],
        "competencies": {},  # 추천 대상이 아닌 '플레이용' 직무 — 역량 매칭은 비움
    }


async def emit_yaml(out_base: str | None = None) -> None:
    """40개 시나리오를 data/scenarios/*.yaml + data/jobs/*.yaml 로 방출 (커밋용).

    out_base 미지정 시 settings.data_dir. 컨테이너의 data/가 읽기전용이면
    쓰기 가능한 경로를 인자로 줘서 방출 후 호스트로 복사한다.
    """
    from app.core.db import SessionFactory

    base = Path(out_base) if out_base else Path(settings.data_dir)
    real = Path(settings.data_dir)  # 손편집 보호 검사는 항상 실제 data/ 기준
    scen_dir, jobs_dir = base / "scenarios", base / "jobs"
    scen_dir.mkdir(parents=True, exist_ok=True)
    jobs_dir.mkdir(parents=True, exist_ok=True)

    wrote = protected_cnt = 0
    async with SessionFactory() as session:
        docs = await build_all_docs(session)
    for cat, doc in docs:
        slug = doc["slug"]
        s_ok = _write_protected(
            scen_dir / f"{slug}.yaml", _dump_yaml(scenario_to_yaml_doc(doc)),
            check_path=real / "scenarios" / f"{slug}.yaml",
        )
        j_ok = _write_protected(
            jobs_dir / f"{slug}.yaml", _dump_yaml(job_to_yaml_doc(cat, slug)),
            check_path=real / "jobs" / f"{slug}.yaml",
        )
        wrote += 1 if (s_ok or j_ok) else 0
        protected_cnt += 1 if not s_ok else 0

    print(
        f"YAML 방출 완료: 시나리오 {len(docs)}개 대상, 기록 {wrote}개, "
        f"보호(손편집) {protected_cnt}개 → data/scenarios/, data/jobs/"
    )


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "db"
    out = sys.argv[2] if len(sys.argv) > 2 else None
    asyncio.run(emit_yaml(out) if cmd == "emit" else main())
