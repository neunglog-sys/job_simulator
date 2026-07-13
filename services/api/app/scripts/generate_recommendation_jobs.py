"""연구 카탈로그(data/prompts/npc/jobs/J001~J103) → 추천 스코어링용 data/jobs/*.yaml 생성.

각 J0xx.yaml에 이미 있는 실제 미션 사실(요청 대사, 필수 행동, 성공 기준, 실패 패턴)을
LLM에 근거로 제공해 description·competencies(1~5)·interest_profile(RIASEC 1~5)을
직무별로 다르게 산출한다. 기계적인 module/family 공식이 아니라 직무마다 실제로
요구되는 능력·흥미유형 차이를 반영하기 위함.

interest_profile은 사전 설문(data/counseling/survey.json, RIASEC 6유형)과 매칭해
추천 스코어링(app/domains/recommendation/service.py)의 보조 신호로 쓰인다 — 설문은
이미 만들어져 있었지만 이 필드가 없어 실제 추천에 반영되지 않던 것을 연결한 것.

직무를 하나씩 독립 호출하면 LLM이 "무난한" 프로필(예: 4,3,4,3,5)로 수렴해 서로 다른
직군(예: 사무보조원 vs 콘텐츠 마케터)도 동점이 나는 문제가 실측됨 — family_id 단위로
묶어서 한 번에 비교 평가시켜 같은 가족 내 실제 차이를 반영하게 한다.

data/jobs는 컨테이너에 read-only로 마운트되어 있어 여기서 바로 못 쓴다 — 결과는
storage/generated-jobs/ 에 쓰고, 호스트에서 data/jobs로 복사한다.

사용: docker compose exec api python -m app.scripts.generate_recommendation_jobs
"""

import asyncio
import glob
import json
import logging
import os
from collections import defaultdict

import yaml

from app.core.config import settings
from app.llm import get_llm
from app.llm.base import ChatMessage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SRC_DIR = os.path.join(settings.data_dir, "prompts", "npc", "jobs")
OUT_DIR = os.path.join(settings.storage_dir, "generated-jobs")
CONCURRENCY = 5

DIMS = ["situation_judgment", "problem_solving", "communication", "collaboration", "task_management"]
RIASEC_DIMS = ["realistic", "investigative", "artistic", "social", "enterprising", "conventional"]
RIASEC_LABELS = {
    "realistic": "현장·실행형(몸으로 부딪히며 실행)",
    "investigative": "분석·탐구형(원인을 파고들어 분석)",
    "artistic": "창작·표현형(새로운 것을 만들고 표현)",
    "social": "대인·조력형(사람을 돕고 소통)",
    "enterprising": "주도·설득형(일을 주도하고 설득)",
    "conventional": "체계·관리형(체계를 잡고 꼼꼼히 관리)",
}

STYLE_EXAMPLES = """\
[예시1] 마케터
시장과 고객을 분석해 제품·서비스의 가치를 전달하는 직무. 캠페인 기획, 콘텐츠 제작, 성과 분석을 수행하며 여러 부서와 협업한다.

[예시2] 백엔드 개발자
서비스의 서버, API, 데이터베이스를 설계하고 운영하는 직무. 기획자·프론트엔드 개발자와 협업하며 요구사항을 안정적인 시스템으로 구현한다.
"""

ANCHORS = """
척도 감각을 위한 앵커(특정 직무 예시가 아니라 기준점입니다):
- task_management 5: 마감·수량·규정 준수가 성패를 가르고, 이를 어긴 실패 사례가 반복 언급됨
- task_management 2: 정해진 마감·수량 관리보다 즉흥적 대응·현장 판단 비중이 큼
- communication 5: 고객·타부서를 설득하거나 응대하는 것이 성과의 핵심
- communication 2: 대부분 혼자 처리하는 후방·내부 업무
- situation_judgment 5: 예외 상황·돌발 변수를 즉시 판단해야 하는 실패 패턴이 반복 등장
- problem_solving 5: 복잡한 원인 분석과 대안 설계가 반복적으로 요구됨
- collaboration 5: 여러 부서·역할과의 조율 품질이 결과물 품질을 좌우함
"""

RIASEC_ANCHORS = """
RIASEC 척도 감각을 위한 앵커:
- realistic 5: 현장에서 물건·장비·시설을 직접 다루거나 몸을 움직이는 업무가 핵심
- investigative 5: 데이터·자료를 분석하거나 원인을 조사·비교하는 업무가 핵심
- artistic 5: 콘텐츠·디자인·카피 등 새로운 결과물을 창작하는 업무가 핵심
- social 5: 고객·이용자를 직접 응대하거나 돕는 것이 업무의 중심
- enterprising 5: 협상·설득·영업·조직 주도가 성과를 좌우함
- conventional 5: 정해진 절차·서류·규정에 따라 정확히 처리하는 것이 핵심
- 해당 없는 유형은 1~2로 낮게 준다 (모든 유형에 고르게 3~4를 주는 것은 무의미함)
"""

SYSTEM_PROMPT = """당신은 진로 체험 플랫폼의 직무 콘텐츠 작가입니다.
같은 직군(family)에 속한 여러 직무의 "직무 사실 정보"(업무 대상, 미션 요청, 필수 행동,
성공 기준, 실패 패턴)가 함께 주어집니다. 각 직무에 대해 다음을 작성하세요.

1. description: 이 직무를 소개하는 자연스러운 한국어 설명 2~4문장.
   - 제공된 사실을 참고해 방향을 잡되, 원문 문구를 그대로 베끼지 말고 새 문장으로 작성한다.
   - 아래 예시와 비슷한 톤·분량으로 쓴다 (직무명을 반복 나열하지 말 것).
""" + STYLE_EXAMPLES + """
2. competencies: 5개 역량(situation_judgment 상황판단력, problem_solving 문제해결력,
   communication 커뮤니케이션, collaboration 협업, task_management 업무관리)의 중요도를
   1~5 정수로 평가한다.
""" + ANCHORS + """
   - 같은 가족 안의 직무들을 서로 비교하며 평가하세요. 사실 정보상 실제로 차이가 있다면
     반드시 점수 차이로 반영해야 합니다. 모든 직무에 4,3,4,3,5 같은 무난한 조합을 반복하는
     것은 금지됩니다 — 같은 가족이라도 업무 요청·필수 행동·실패 패턴이 다르면 프로필도
     달라야 합니다.

3. interest_profile: 진로 흥미유형(RIASEC, Holland 모형) 6개 차원 각각에 대해 이
   직무가 요구/부합하는 정도를 1~5 정수로 평가한다. 6개 차원: """ + ", ".join(
    f"{k}({v})" for k, v in RIASEC_LABELS.items()
) + """
""" + RIASEC_ANCHORS + """
   - competencies와 마찬가지로 같은 가족 안에서도 직무 성격(현장/분석/창작/대인/주도/체계)이
     다르면 반드시 프로필이 달라야 합니다. 6개 차원에 모두 비슷한 점수를 주는 것은 금지됩니다.

4. rationale: 왜 그렇게 평가했는지, 다른 직무와 무엇이 달라서 그런 점수를 줬는지 1문장
   (내부 검수용, 화면에 노출되지 않음)

입력으로 주어진 직무 개수와 정확히 같은 개수의 결과를 job_id 기준으로 반환하세요.
"""


def _dedup(items: list[str], cap: int) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.append(item)
        if len(seen) >= cap:
            break
    return seen


def _extract_job_facts(doc: dict) -> dict:
    job = doc["job"]
    nv = doc["prompt_contract"]["npc_visible"]

    categories, workflows = [], []
    request_lines, user_missions = [], []
    required_actions, success_criteria, failure_patterns = [], [], []

    for variant in doc.get("content_variants", []):
        if variant.get("category"):
            categories.append(variant["category"])
        if variant.get("workflow"):
            workflows.append(variant["workflow"])
        for mission in variant.get("missions", []):
            mnv = mission.get("npc_visible", {})
            mcp = mission.get("coach_private", {})
            if mnv.get("request_line"):
                request_lines.append(mnv["request_line"])
            if mnv.get("user_mission"):
                user_missions.append(mnv["user_mission"])
            required_actions.extend(mcp.get("required_actions", []))
            success_criteria.extend(mcp.get("success_criteria", []))
            failure_patterns.extend(mcp.get("failure_patterns", []))

    return {
        "job_id": job["job_id"],
        "job_name": job["job_name"],
        "family_name": job["family_name"],
        "module": job["module"],
        "work_targets": nv.get("work_targets", []),
        "npc_roles": nv.get("npc_roles", []),
        "outputs": nv.get("outputs", []),
        "categories": _dedup(categories, 5),
        "workflows": _dedup(workflows, 4),
        "request_lines": _dedup(request_lines, 6),
        "user_missions": _dedup(user_missions, 8),
        "required_actions": _dedup(required_actions, 15),
        "success_criteria": _dedup(success_criteria, 15),
        "failure_patterns": _dedup(failure_patterns, 10),
    }


def _facts_to_text(facts: dict) -> str:
    lines = [
        f"### job_id: {facts['job_id']}",
        f"직무명: {facts['job_name']} (직군: {facts['family_name']}, 업무유형: {facts['module']})",
        f"업무 대상: {', '.join(facts['work_targets'])}",
        f"협업 상대: {', '.join(facts['npc_roles'])}",
        f"산출물: {', '.join(facts['outputs'])}",
        f"세부 카테고리: {', '.join(facts['categories'])}",
    ]
    if facts["workflows"]:
        lines.append("업무 흐름:")
        lines += [f"  - {w}" for w in facts["workflows"]]
    if facts["request_lines"]:
        lines.append("실제 업무 요청 예시:")
        lines += [f"  - {r}" for r in facts["request_lines"]]
    if facts["user_missions"]:
        lines.append("수행해야 하는 미션:")
        lines += [f"  - {m}" for m in facts["user_missions"]]
    if facts["required_actions"]:
        lines.append("필수 행동:")
        lines += [f"  - {a}" for a in facts["required_actions"]]
    if facts["success_criteria"]:
        lines.append("성공 기준:")
        lines += [f"  - {s}" for s in facts["success_criteria"]]
    if facts["failure_patterns"]:
        lines.append("실패 패턴(이걸 하면 안 됨):")
        lines += [f"  - {f}" for f in facts["failure_patterns"]]
    return "\n".join(lines)


def _schema(job_ids: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "jobs": {
                "type": "array",
                "minItems": len(job_ids),
                "maxItems": len(job_ids),
                "items": {
                    "type": "object",
                    "properties": {
                        "job_id": {"type": "string", "enum": job_ids},
                        "description": {"type": "string"},
                        "competencies": {
                            "type": "object",
                            "properties": {
                                k: {"type": "integer", "minimum": 1, "maximum": 5} for k in DIMS
                            },
                            "required": DIMS,
                            "additionalProperties": False,
                        },
                        "interest_profile": {
                            "type": "object",
                            "properties": {
                                k: {"type": "integer", "minimum": 1, "maximum": 5}
                                for k in RIASEC_DIMS
                            },
                            "required": RIASEC_DIMS,
                            "additionalProperties": False,
                        },
                        "rationale": {"type": "string"},
                    },
                    "required": [
                        "job_id",
                        "description",
                        "competencies",
                        "interest_profile",
                        "rationale",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["jobs"],
        "additionalProperties": False,
    }


async def _generate_family(
    family_name: str, paths: list[str], sem: asyncio.Semaphore
) -> dict[str, tuple[dict, str] | None]:
    facts_by_id = {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        facts = _extract_job_facts(doc)
        facts_by_id[facts["job_id"]] = facts

    job_ids = list(facts_by_id.keys())
    body = "\n\n".join(_facts_to_text(facts_by_id[jid]) for jid in job_ids)
    user_content = f"## {family_name} 직군 — 직무 사실 정보 (총 {len(job_ids)}개)\n{body}"

    async with sem:
        try:
            result = await get_llm().chat_json(
                [ChatMessage(role="user", content=user_content)],
                system=SYSTEM_PROMPT,
                json_schema=_schema(job_ids),
                temperature=0.5,
            )
        except Exception as e:  # noqa: BLE001 — 배치 생성 스크립트, 실패는 로그로 남기고 계속
            logger.error("가족 실패 %s (%s): %s", family_name, job_ids, e)
            return {jid: None for jid in job_ids}

    out = {}
    returned = {item["job_id"]: item for item in result.get("jobs", [])}
    for jid in job_ids:
        item = returned.get(jid)
        if item is None:
            logger.error("응답 누락 job_id=%s (family=%s)", jid, family_name)
            out[jid] = None
            continue
        code = jid.lower()
        out_doc = {
            "code": code,
            "title": facts_by_id[jid]["job_name"],
            "description": item["description"].strip(),
            "competencies": item["competencies"],
            "interest_profile": item["interest_profile"],
        }
        out[jid] = (out_doc, item.get("rationale", ""))
    return out


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC_DIR, "J*.yaml")))
    logger.info("대상 %d개 파일", len(files))

    groups: dict[str, list[str]] = defaultdict(list)
    for path in files:
        with open(path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        groups[doc["job"]["family_name"]].append(path)
    logger.info("가족 %d개로 배치", len(groups))

    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [_generate_family(name, paths, sem) for name, paths in groups.items()]
    family_results = await asyncio.gather(*tasks)

    rationale_log = {}
    ok, failed = 0, []
    for family_out in family_results:
        for jid, value in family_out.items():
            code = jid.lower()
            if value is None:
                failed.append(code)
                continue
            out_doc, rationale = value
            header = (
                f"# {jid} — LLM 생성(연구 카탈로그 기반, family 단위 비교평가), "
                f"원본: data/prompts/npc/jobs/{jid}_*.yaml\n"
            )
            body = yaml.safe_dump(out_doc, allow_unicode=True, sort_keys=False, width=100)
            with open(os.path.join(OUT_DIR, f"{code}.yaml"), "w", encoding="utf-8") as f:
                f.write(header + body)
            rationale_log[code] = rationale
            ok += 1

    with open(os.path.join(OUT_DIR, "_rationale_log.json"), "w", encoding="utf-8") as f:
        json.dump(rationale_log, f, ensure_ascii=False, indent=2)

    logger.info("완료: 성공 %d개, 실패 %d개 %s", ok, len(failed), failed)


if __name__ == "__main__":
    asyncio.run(main())
