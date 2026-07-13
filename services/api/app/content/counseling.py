"""상담 데이터팩(data/counseling/*.json) 로더 + 규칙 기반 순수 유틸리티.

DB 세션이나 LLM 호출에 의존하지 않는다. 여기서 만드는 함수들은 상담/추천 API의
핫 패스를 대체하지 않으며, 지금은 avatar/system.md 렌더링에 안전 규칙 요약
문자열(build_safety_notes)을 주입하는 한 지점에서만 실제로 호출된다.
자세한 배경은 docs/counseling/current_counseling_audit.md §19, counseling_process.md 참고.
"""

import json
from functools import lru_cache
from pathlib import Path

from app.core.config import settings

_COUNSELING_DIR = "counseling"


@lru_cache
def _load_json(filename: str) -> dict:
    path = Path(settings.data_dir) / _COUNSELING_DIR / filename
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_question_bank() -> list[dict]:
    return _load_json("question_bank.json")["questions"]


def load_dimension_definitions() -> list[dict]:
    return _load_json("dimension_definitions.json")["dimensions"]


def load_evidence_rules() -> dict:
    return _load_json("evidence_rules.json")


def load_followup_rules() -> dict:
    return _load_json("followup_rules.json")


def load_recommendation_gate_rules() -> dict:
    return _load_json("recommendation_gate_rules.json")


def load_module_mapping() -> dict:
    return _load_json("module_mapping.json")


def load_safety_rules() -> dict:
    return _load_json("safety_rules.json")


def get_question(question_id: str) -> dict | None:
    return next((q for q in load_question_bank() if q["question_id"] == question_id), None)


def get_dimension(dimension_code: str) -> dict | None:
    return next(
        (d for d in load_dimension_definitions() if d["dimension_code"] == dimension_code), None
    )


def _dimension_group(dimension_code: str) -> str:
    return dimension_code.split(".", 1)[0]


# ── 다음 질문 선택 (규칙 기반, LLM 호출 없음) ────────────────────────────

def select_next_question(
    asked_question_ids: set[str] | list[str],
    evidence_count: dict[str, int] | None = None,
    confidence: dict[str, float] | None = None,
    conflicted_dimensions: set[str] | list[str] | None = None,
    recent_target_groups: list[str] | None = None,
) -> dict | None:
    """정보가치가 가장 높아 보이는 질문 1개를 규칙으로 고른다.

    - 같은 축(동일 dimension group) 질문은 연속 2회까지만 허용.
    - 축 충돌(conflicted_dimensions)이 있으면 그 축을 겨냥한 질문을 최우선.
    - 그 외엔 근거 수(evidence_count)가 적거나 신뢰도(confidence)가 낮은 축을 우선.
    """
    asked = set(asked_question_ids)
    evidence_count = evidence_count or {}
    confidence = confidence or {}
    conflicted = set(conflicted_dimensions or [])
    recent_groups = (recent_target_groups or [])[-2:]

    unasked = [q for q in load_question_bank() if q["question_id"] not in asked]
    if not unasked:
        return None

    blocked_group = None
    if len(recent_groups) == 2 and recent_groups[0] == recent_groups[1]:
        blocked_group = recent_groups[0]

    def group_of(question: dict) -> str | None:
        dims = question["target_dimensions"]
        return _dimension_group(dims[0]) if dims else None

    candidates = [q for q in unasked if group_of(q) != blocked_group] or unasked

    if conflicted:
        conflict_hits = [q for q in candidates if set(q["target_dimensions"]) & conflicted]
        if conflict_hits:
            return min(conflict_hits, key=lambda q: q["priority"])

    weak = [
        q
        for q in candidates
        if any(
            evidence_count.get(dim, 0) < 2 or confidence.get(dim, 0) < 40
            for dim in q["target_dimensions"]
        )
    ]
    pool = weak if weak else candidates
    return min(pool, key=lambda q: q["priority"])


# ── 추천 게이트 판정 (목표 상태, PR#7 라이브 게이트를 대체하지 않음) ──────

def evaluate_gate(profile: dict) -> dict:
    """recommendation_gate_rules.json 기준 통과 여부와 미충족 조건 목록을 반환."""
    required = load_recommendation_gate_rules()["required_conditions"]
    missing: list[str] = []

    if not profile.get("purpose_confirmed"):
        missing.append("purpose_confirmed")
    if profile.get("interest_evidence_count", 0) < required["min_interest_evidence_count"]:
        missing.append("min_interest_evidence_count")
    if profile.get("work_style_evidence_count", 0) < required["min_work_style_evidence_count"]:
        missing.append("min_work_style_evidence_count")
    if not profile.get("top_work_values_confirmed"):
        missing.append("top_work_values_confirmed")
    if not profile.get("constraints_confirmed"):
        missing.append("constraints_confirmed")
    if (
        profile.get("min_independent_evidence_per_top_module", 0)
        < required["min_independent_evidence_per_top_module"]
    ):
        missing.append("min_independent_evidence_per_top_module")
    if not profile.get("user_interim_summary_confirmed"):
        missing.append("user_interim_summary_confirmed")
    if not profile.get("key_contradictions_resolved"):
        missing.append("key_contradictions_resolved")

    return {"passed": not missing, "missing_conditions": missing}


# ── 모듈/중분류/대표미션 매핑 (실제 8모듈·40중분류·40대표미션만 참조) ─────

def map_to_modules(dimension_scores: dict[str, float], top_n: int = 3) -> list[dict]:
    """축 점수 → 상위 모듈 후보. RIASEC 등 단일 축이 아니라 전체 축 가중합으로 계산."""
    scored = []
    for m in load_module_mapping()["modules"]:
        score = sum(
            dimension_scores.get(dim, 0) * weight for dim, weight in m["dimension_weights"].items()
        )
        scored.append(
            {
                "module": m["module"],
                "score": score,
                "categories": m["categories"],
                "representative_mission_codes": m["representative_mission_codes"],
            }
        )
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_n]


# ── 금지 표현 점검 ────────────────────────────────────────────────────

def _core_phrase(raw: str) -> str:
    s = raw.strip()
    if s.startswith('"'):
        end = s.rfind('"')
        s = s[1 : end if end > 0 else None]
    if " (" in s and s.endswith(")"):
        s = s[: s.index(" (")]
    return s.strip()


def check_forbidden_phrases(text: str) -> list[str]:
    """text에 safety_rules.json의 금지 표현이 그대로 포함되어 있으면 rule_id 목록 반환."""
    hits = []
    for rule in load_safety_rules()["rules"]:
        for raw in rule["forbidden_phrases"]:
            phrase = _core_phrase(raw)
            if phrase and phrase in text:
                hits.append(rule["rule_id"])
                break
    return hits


def build_safety_notes() -> str:
    """avatar/system.md에 주입할 안전 규칙 요약(짧은 불릿 목록).

    현재 유일하게 라이브 요청 경로(consultation/service.py)에 실제로 연결되는 함수.
    데이터팩 로딩에 실패하면 호출부에서 None으로 폴백하고 기존 프롬프트 그대로 렌더링한다.
    """
    principles = [rule["principle"] for rule in load_safety_rules()["rules"][:6]]
    return "\n".join(f"- {p}" for p in principles)
