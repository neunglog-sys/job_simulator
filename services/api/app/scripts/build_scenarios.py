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

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import validate_scenario, yaml_scenario_slugs
from app.domains.scoring.aggregate import TYPE_COMPETENCY
from app.models import Job, NpcPersona, Scenario, TeamCategory, TeamMission, TeamRepMission

logger = logging.getLogger(__name__)

# 일과 미션의 표준 순서 (기승전결 난이도 곡선) — 역량 매핑(aggregate)과 단일 소스
TYPE_ORDER = list(TYPE_COMPETENCY)

# 모듈 공통 시작 상태값 — npc 프롬프트 템플릿이 참조하는 3개 키 고정
INITIAL_STATE = {"trust": 50, "schedule_stability": 70, "requirement_clarity": 20}

# ── NPC 아키타입 (역할명 키워드 분류 → 규칙 뼈대) ─────────────────────
ARCHETYPES = {
    "mentor": {
        "keywords": ["사수", "선임", "수석", "시니어", "반장", "주임", "베테랑"],
        "personality": "경험 많고 실무에 밝다. 물어보면 절차와 기준을 알려주지만 답을 대신 정해주지는 않는다.",
        "prompt": (
            "당신은 '{category}' 현장의 {role}이며 신입인 사용자의 사수입니다. "
            "업무 흐름({work_flow})을 훤히 알고 있고, 사용자가 구체적으로 물어보면 "
            "절차·기준·주의점을 알려줍니다. 묻지 않은 것을 먼저 다 알려주지 않으며, "
            "사용자가 고민 없이 결정하면 '그렇게 하면 어떻게 될 것 같아요?'라고 되묻습니다. "
            "정답을 통째로 불러주지 않습니다. 말투는 간결하고 현장감 있게."
        ),
    },
    "supervisor": {
        "keywords": ["팀장", "과장", "부장", "점장", "지점장", "소장", "원장", "센터장",
                     "실장", "매니저", "지휘관", "당직", "기관장", "책임"],
        "personality": "승인·보고를 받는 책임자. 꼼꼼하고 근거를 요구하며, 형식을 갖춘 보고에는 협조적이다.",
        "prompt": (
            "당신은 '{category}' 현장의 {role}이며 사용자의 보고·승인 라인입니다. "
            "업무 지시를 내리고 결과 보고를 받습니다. 보고가 두루뭉술하면 '근거가 뭐예요?', "
            "'우선순위 기준은요?'라고 되묻고, 사실·근거·다음 조치가 갖춰진 보고에는 명확히 "
            "승인해줍니다. 사용자가 확인 없이 단정하면 지적합니다. 말투는 단정하고 짧게."
        ),
    },
    "counterpart": {
        "keywords": ["고객", "환자", "민원", "회원", "승객", "학부모", "보호자", "투숙객",
                     "이용자", "의뢰", "차주", "임차인", "구매", "손님", "시민"],
        "personality": "응대 대상. 자신의 요구와 상황은 잘 알지만 내부 절차는 모르며, 응대 태도에 민감하게 반응한다.",
        "prompt": (
            "당신은 '{category}' 현장에서 사용자가 응대해야 하는 {role}입니다. "
            "당신의 요구사항·상황 정보는 사용자가 정중히 물어봐야 조금씩 말해줍니다. "
            "성의 있게 응대하면 협조적으로 변하고, 성의 없거나 절차만 따지면 불만을 표현합니다. "
            "내부 규정·기술 용어는 모릅니다. 실제 사람처럼 자연스럽게 말하세요."
        ),
    },
    "colleague": {  # 분류 실패 시 기본값
        "keywords": [],
        "personality": "협업 부서의 담당자. 자기 영역 정보를 갖고 있고 요청이 명확하면 협조한다.",
        "prompt": (
            "당신은 '{category}' 현장에서 사용자와 협업하는 {role}입니다. "
            "당신 영역의 정보(자료, 일정, 현황)는 사용자가 명확히 요청해야 공유합니다. "
            "요청이 애매하면 '정확히 뭐가 필요하세요?'라고 되묻습니다. 말투는 사무적이지만 우호적."
        ),
    },
}


def norm_role(role: str) -> str:
    """NPC 역할명 정규화 — 괄호 설명 제거. 페르소나 등록과 미션 참조 양쪽에 동일 적용."""
    return re.sub(r"\(.*?\)", "", role or "").strip()


def classify(role: str) -> str:
    for key in ("supervisor", "mentor", "counterpart"):  # 직급 키워드 우선 ('고객지원 팀장'=상사)
        if any(k in role for k in ARCHETYPES[key]["keywords"]):
            return key
    return "colleague"


def build_personas(category: str, work_flow: str, roles: list[str]) -> list[dict]:
    """역할명 목록 → 페르소나 (최소 3명 보장: 사수·상사·응대상대 축)."""
    personas, seen_types = [], set()
    for role in roles:
        arch_key = classify(role)
        arch = ARCHETYPES[arch_key]
        seen_types.add(arch_key)
        personas.append({
            "name": role,
            "rank": role,
            "personality": arch["personality"],
            "system_prompt": arch["prompt"].format(
                category=category, role=role, work_flow=(work_flow or "")[:200]
            ),
        })
    # 조사에 실존하는 NPC가 3명 이상이면 그대로 사용 (근거 없는 가공 NPC 주입 금지).
    # 3명 미만일 때만 빠진 축을 기본 역할로 보충 — '최소 3명' 지시 충족용 최후 수단
    fallback = {"mentor": "선임 사수", "supervisor": "담당 팀장", "counterpart": "방문 고객"}
    for arch_key, default_role in fallback.items():
        if len(personas) >= 3:
            break
        if arch_key not in seen_types:
            arch = ARCHETYPES[arch_key]
            personas.append({
                "name": default_role,
                "rank": default_role,
                "personality": arch["personality"],
                "system_prompt": arch["prompt"].format(
                    category=category, role=default_role, work_flow=(work_flow or "")[:200]
                ),
            })
    return personas


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
    """미션 NPC 필드 파싱 — 콤마 분리 + 괄호 정규화 (페르소나 이름과 동일 규칙)."""
    return [norm_role(r) for r in (raw or "").split(",") if norm_role(r)]


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


def mission_to_step(m: TeamMission, step_id: str) -> dict:
    npcs = mission_npcs(m.npc)
    npc = npcs[0] if npcs else ""
    return {
        "id": step_id,
        "type": m.situation_type,
        "title": m.situation_type or "업무 미션",
        "mission": (
            f'{npc}: "{m.npc_line}"\n\n{m.mission}' if m.npc_line else (m.mission or "")
        ),
        "npcs": npcs,
        "guide": f"제공 자료: {m.materials}" if m.materials else None,
        "task": build_task(m),
    }


def build_scenario_doc(
    category: TeamCategory, missions: list[TeamMission], rep_codes: set[str]
) -> dict | None:
    """중분류 1개 → 시나리오 문서. 미션 부족 등은 None (스킵, 로그)."""
    if not missions:
        logger.warning("스킵 %s: 미션 없음", category.category)
        return None

    rep = [m for m in missions if m.mission_code in rep_codes]
    daily = [m for m in missions if m.mission_code not in rep_codes]
    if len(daily) < 2:  # 스텝 2개 미만이면 퀘스트 발동 불가 — rep를 본편 스텝으로 유지 (소실 방지)
        daily, rep = missions, []

    order = {t: i for i, t in enumerate(TYPE_ORDER)}
    daily.sort(key=lambda m: order.get(m.situation_type, 99))

    steps = [mission_to_step(m, f"m{i}") for i, m in enumerate(daily, 1)]
    for i, step in enumerate(steps):
        step["task"]["on_pass"] = steps[i + 1]["id"] if i + 1 < len(steps) else "__end__"

    quest = None
    if rep and len(steps) >= 2:  # 스텝 1개면 전환이 없어 발동 불가 — 퀘스트 생략
        q = rep[0]
        q_npcs = mission_npcs(q.npc)
        q_npc = q_npcs[0] if q_npcs else ""
        quest = {
            "npc": q_npc,
            "intro": f'{q_npc}이(가) 다급하게 찾아왔다. "{q.npc_line}"' if q.npc_line
                     else "예상치 못한 상황이 발생했다.",
            "task": {**mission_to_step(q, "quest")["task"], "type": q.situation_type},
        }

    # NPC: 연결맵 역할 + 미션 등장 NPC 합집합 (최소 3명 아키타입 보장)
    roles: list[str] = []
    for src in [category.npc_roles or ""] + [m.npc or "" for m in missions]:
        for r in src.split(","):
            r = norm_role(r)
            if r and r not in roles:
                roles.append(r)
    personas = build_personas(category.category, category.work_flow, roles)

    # 스텝·퀘스트가 참조하는 NPC가 페르소나에 없으면 미션 진행 불가 — 보정
    persona_names = {p["name"] for p in personas}
    for step in steps:
        step["npcs"] = [n for n in step["npcs"] if n in persona_names] or [personas[0]["name"]]
    if quest and quest["npc"] not in persona_names:
        quest["npc"] = personas[0]["name"]

    return {
        "job": None,  # main()에서 slug로 설정 (변환 시나리오의 job 코드 = slug 규칙)
        "slug": None,  # main()에서 결정
        "title": f"{category.category} — 신입의 하루",
        "module": category.module,
        "initial_state": dict(INITIAL_STATE),
        "steps": steps,
        "sudden_quest": quest,
        "npcs": personas,
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

    # 페르소나는 통째로 교체 (변환본은 항상 최신 조사 기준)
    await session.execute(delete(NpcPersona).where(NpcPersona.scenario_id == scenario_id))
    for p in doc["npcs"]:
        session.add(NpcPersona(scenario_id=scenario_id, **p))


async def main() -> None:
    from app.core.db import SessionFactory

    protected = yaml_scenario_slugs()  # 사람 검수 YAML이 소유한 slug는 건드리지 않음
    used_slugs: dict[str, str] = {}
    built = skipped = 0

    async with SessionFactory() as session:
        categories = list(
            (await session.execute(select(TeamCategory).order_by(TeamCategory.id))).scalars()
        )
        rep_codes = set(
            (await session.execute(select(TeamRepMission.mission_code))).scalars()
        )
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
            doc = build_scenario_doc(cat, missions, rep_codes)
            if doc is None:
                skipped += 1
                continue
            doc["slug"] = slug_for(missions, cat.no or cat.id, cat.owner)
            if doc["slug"] in used_slugs:  # 조용한 덮어쓰기 방지 — 데이터 문제를 즉시 드러냄
                raise ValueError(
                    f"slug 충돌: '{doc['slug']}' ← {cat.category} vs {used_slugs[doc['slug']]}"
                )
            used_slugs[doc["slug"]] = cat.category
            if doc["slug"] in protected:
                logger.info("스킵 %s: 검수 YAML(%s)이 우선", cat.category, doc["slug"])
                skipped += 1
                continue
            doc["job"] = doc["slug"]  # 변환 시나리오의 job 코드 = slug
            validate_scenario(doc, f"변환:{cat.category}")
            await upsert_scenario(
                session, doc,
                job_code=doc["slug"], job_title=cat.category, description=cat.work_flow,
            )
            built += 1
        await session.commit()

    print(f"시나리오 변환 완료: 생성/갱신 {built}건, 스킵 {skipped}건 (검수 YAML 보호 포함)")


if __name__ == "__main__":
    asyncio.run(main())
