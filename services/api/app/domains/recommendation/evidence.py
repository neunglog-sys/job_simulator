"""추천근거 개인화 — 상담 대화에서 '검증된 실제 발화 인용'을 근거로 추출·저장·노출.

설계의 심장은 **결정론적 그라운딩 게이트**(`_ground_quote`)다: LLM이 뽑은 인용문이 사용자
실제 발화의 부분 문자열인지 순수 파이썬 코드로 검증하고, 아니면 버린다. 게이트가 LLM 신뢰가
아니라 코드이므로 날조 인용은 구조적으로 저장·노출될 수 없다("한 사람의 인생이 걸릴 수도 있는
데이터" — 근거 없으면 지어내지 말고 생략).

- 추출은 기존 `_extract_profile`(service.py)의 aptitude_clarity 게이트 추출과 **완전히 분리**된
  별도 LLM 호출이다. 게이트 추출을 건드리지 않아 추천 통과/차단 판정에 0 회귀.
- 신뢰도(confidence)는 evidence_rules.json 규칙에서 **결정론적으로 계산**한다(LLM 추측 아님).
- 저장은 dormant였던 Evidence 테이블(models.Evidence)을 실데이터로 활성화한다.
"""

import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.domains.consultation.service import list_messages
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Evidence, Job

logger = logging.getLogger(__name__)

# 사용자에게 노출(모달·리포트)할 최소 신뢰도 — conversation_explicit base(60) 기준.
# 이보다 낮은(약한 추론) 근거는 저장은 하되 표면화하지 않는다.
SURFACE_MIN_CONFIDENCE = 60
# 그라운딩 최소 길이 — 너무 짧은 조각("네", "좋아요")이 우연히 부분문자열로 통과하는 것 방지.
MIN_QUOTE_LEN = 8

# 8모듈 43축 skill.* → 평가 5역량(data/evaluation/competencies.yaml) 정적 대응.
# 사용자 데이터가 아니라 **택소노미 브리지**(정의상 대응)라 검토·수정 가능하고 날조가 아니다.
# 대응이 모호한 skill(creative_production/tool_operation)은 의도적으로 비워, competencies형
# 직무에는 억지로 붙이지 않고 생략한다.
SKILL_TO_COMPETENCY = {
    "skill.communication": "communication",
    "skill.coordination": "collaboration",
    "skill.error_detection": "problem_solving",
    "skill.data_analysis": "problem_solving",
    "skill.priority_judgment": "task_management",
    "skill.risk_detection": "situation_judgment",
}

_WS = re.compile(r"\s+")


@dataclass
class EvidenceItem:
    dimension_code: str
    quote: str
    value: str
    source_type: str
    confidence: int


# ── 데이터팩 로드 ─────────────────────────────────────────────────────────
@lru_cache
def _dimensions() -> list[dict]:
    path = Path(settings.data_dir) / "counseling" / "dimension_definitions.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)["dimensions"]


@lru_cache
def _evidence_rules() -> dict:
    path = Path(settings.data_dir) / "counseling" / "evidence_rules.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def _valid_dimension_codes() -> frozenset[str]:
    return frozenset(d["dimension_code"] for d in _dimensions())


@lru_cache
def _dimension_names() -> dict[str, str]:
    return {d["dimension_code"]: d["name"] for d in _dimensions()}


# ── 그라운딩 게이트 (결정론, 순수 함수) ────────────────────────────────────
def _normalize(text: str) -> str:
    """공백만 압축·trim. 문장부호는 보존한다 — 인용의 원문성을 지키기 위함."""
    return _WS.sub(" ", text or "").strip()


def _ground_quote(quote: str, user_text: str) -> bool:
    """quote가 사용자 발화의 부분 문자열인지 검증. 아니면 False(→ 폐기).

    이 함수가 날조 인용을 막는 최종 방어선이다. LLM 출력을 신뢰하지 않고 코드로 검증한다.
    """
    q = _normalize(quote)
    if len(q) < MIN_QUOTE_LEN:
        return False
    return q in _normalize(user_text)


# ── 신뢰도 계산 (evidence_rules.json에서 결정론적으로) ─────────────────────
def _score_confidence(source_type: str, flags: dict) -> int:
    """source_type의 base_confidence + 해당 bonus − penalty, 0~100 클램프.

    LLM이 매기는 게 아니라 규칙 데이터에서 계산 → 같은 입력이면 항상 같은 점수(재현 가능).
    """
    rules = {r["source_type"]: r for r in _evidence_rules()["rules"]}
    # required_elements 미충족(explicit인데 행동 사례 없음)이면 inferred로 강등 — 규칙 충실.
    if source_type == "conversation_explicit" and not flags.get("has_behavior_example"):
        source_type = "conversation_inferred"
    rule = rules.get(source_type)
    if rule is None:
        return 0

    # 단일 패스라 prior-evidence 의존 조건(consistent/contradicts 등)은 신호가 없어 미적용.
    when_true = {
        "reason_included": bool(flags.get("reason_included")),
        "specific_outcome_included": bool(flags.get("specific_outcome_included")),
        "hypothetical_phrasing": bool(flags.get("hypothetical_phrasing")),
        "single_word_answer": bool(flags.get("single_word_answer")),
        "vague_self_assessment": not bool(flags.get("has_behavior_example")),
    }
    score = int(rule["base_confidence"])
    for bonus in rule.get("confidence_bonus", []):
        if when_true.get(bonus["when"]):
            score += int(bonus["amount"])
    for penalty in rule.get("confidence_penalty", []):
        if when_true.get(penalty["when"]):
            score += int(penalty["amount"])  # amount는 음수로 저장돼 있음
    return max(0, min(100, score))


# ── 추출 ──────────────────────────────────────────────────────────────────
def _extraction_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "evidence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "dimension_code": {"type": "string"},
                        "quote": {"type": "string"},
                        "value": {"type": "string"},
                        "source_type": {
                            "type": "string",
                            "enum": ["conversation_explicit", "conversation_inferred"],
                        },
                        "has_behavior_example": {"type": "boolean"},
                        "reason_included": {"type": "boolean"},
                        "specific_outcome_included": {"type": "boolean"},
                        "hypothetical_phrasing": {"type": "boolean"},
                        "single_word_answer": {"type": "boolean"},
                    },
                    "required": [
                        "dimension_code", "quote", "value", "source_type",
                        "has_behavior_example", "reason_included",
                        "specific_outcome_included", "hypothetical_phrasing",
                        "single_word_answer",
                    ],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["evidence"],
        "additionalProperties": False,
    }


async def extract_from_transcript(transcript: str, user_text: str) -> list[EvidenceItem]:
    """대화 텍스트 → 그라운딩 검증을 통과한 근거만 반환. DB 비의존(골든셋 스크립트도 재사용).

    LLM 실패 시 빈 리스트(추천은 살린다). ①축 실재 ②그라운딩 게이트를 통과한 후보만 남긴다.
    """
    if not user_text.strip():
        return []
    system = render_prompt("recommendation/evidence.md", dimensions=_dimensions())
    try:
        raw = await get_llm().chat_json(
            [ChatMessage(role="user", content=f"## 상담 대화\n{transcript}")],
            system=system,
            json_schema=_extraction_schema(),
            temperature=0.0,  # 근거 판정도 결정적이어야 한다.
        )
    except Exception as e:  # noqa: BLE001 — 근거는 부가 기능, 실패해도 추천 자체는 살린다.
        logger.warning("근거 추출 LLM 실패: %s", e)
        return []

    valid_codes = _valid_dimension_codes()
    items: list[EvidenceItem] = []
    for cand in raw.get("evidence", []):
        code = cand.get("dimension_code", "")
        quote = cand.get("quote", "")
        # ① 축이 43축에 실재하는가(LLM 오타·환각 코드 드롭)
        if code not in valid_codes:
            continue
        # ② 그라운딩 게이트 — 실제 발화 부분문자열인가(날조 인용 드롭)
        if not _ground_quote(quote, user_text):
            logger.debug("그라운딩 실패 드롭: %r", quote[:40])
            continue
        source_type = cand.get("source_type") or "conversation_inferred"
        confidence = _score_confidence(source_type, cand)
        items.append(EvidenceItem(
            dimension_code=code,
            quote=_normalize(quote),
            value=str(cand.get("value") or "")[:100],
            source_type=source_type,
            confidence=confidence,
        ))
    return items


async def extract_grounded_evidence(
    session: AsyncSession, consultation: Consultation
) -> list[EvidenceItem]:
    """상담 대화(DB) → 그라운딩 검증을 통과한 근거. 그라운딩은 사용자 발화만 대상으로 검증한다."""
    messages = await list_messages(session, consultation.id)
    user_text = "\n".join(m.content for m in messages if m.role == "user")
    transcript = "\n".join(
        f"{'사용자' if m.role == 'user' else '상담사'}: {m.content}" for m in messages
    )
    return await extract_from_transcript(transcript, user_text)


# ── 저장 ──────────────────────────────────────────────────────────────────
async def persist_evidence(
    session: AsyncSession, consultation: Consultation, items: list[EvidenceItem]
) -> None:
    """검증 통과 근거를 Evidence 테이블에 저장. commit은 호출자 트랜잭션에 맡긴다.

    재생성 안전을 위해 이 상담의 기존 상담-단계 근거를 먼저 지우고 새로 넣는다(멱등).
    """
    await session.execute(
        delete(Evidence).where(
            Evidence.consultation_id == consultation.id,
            Evidence.stage == "counseling",
        )
    )
    for it in items:
        session.add(Evidence(
            consultation_id=consultation.id,
            simulation_id=None,
            stage="counseling",
            dimension_code=it.dimension_code,
            source_type=it.source_type,
            evidence_text=it.quote,
            value=it.value,
            confidence=it.confidence,
            confirmed_by_user=False,
        ))


# ── 추천 직무별 근거 매칭 ──────────────────────────────────────────────────
def _job_relevance(job: Job, dim_code: str) -> float | None:
    """이 근거 축이 해당 직무와 얼마나 관련되는가(가중치). 관련 없으면 None.

    ① 카테고리 직무(dimension_weights): 43축 직접 겹침.
    ② interest.* 근거 ↔ interest_profile(RIASEC) — prefix 제거 후 직접 대응(실제 매핑).
    ③ skill.* 근거 ↔ 5역량 — SKILL_TO_COMPETENCY 정적 브리지.
    겹치는 신호가 없으면 None → 이 직무엔 이 근거를 붙이지 않는다(생략 원칙).
    """
    dw = job.dimension_weights or {}
    if dim_code in dw:
        try:
            w = float(dw[dim_code])
        except (TypeError, ValueError):
            return None
        return w if w > 0 else None

    if dim_code.startswith("interest."):
        w = (job.interest_profile or {}).get(dim_code.removeprefix("interest."))
        return float(w) if w else None

    comp = SKILL_TO_COMPETENCY.get(dim_code)
    if comp:
        w = (job.competencies or {}).get(comp)
        return float(w) if w else None
    return None


def attach_to_recommendations(
    ranked_jobs: list[Job], items: list[EvidenceItem]
) -> dict[str, dict | None]:
    """직무 code → 표면화할 근거(dict) 또는 None.

    노출 대상은 confidence≥SURFACE_MIN인 근거만. 직무마다 관련도(weight)×confidence가 가장 높은
    근거를 고르되, **같은 quote를 여러 직무에 재사용하지 않는다**(템플릿처럼 보이는 것 방지).
    관련 근거가 없는 직무는 None(억지로 붙이지 않음).
    """
    names = _dimension_names()
    surfaced = sorted(
        (it for it in items if it.confidence >= SURFACE_MIN_CONFIDENCE),
        key=lambda it: it.confidence,
        reverse=True,
    )
    used_quotes: set[str] = set()
    out: dict[str, dict | None] = {}
    for job in ranked_jobs:
        best: EvidenceItem | None = None
        best_score = -1.0
        for it in surfaced:
            if it.quote in used_quotes:
                continue
            rel = _job_relevance(job, it.dimension_code)
            if rel is None:
                continue
            score = rel * it.confidence
            if score > best_score:
                best, best_score = it, score
        if best is not None:
            used_quotes.add(best.quote)
            out[job.code] = {
                "quote": best.quote,
                "dimension_name": names.get(best.dimension_code, best.dimension_code),
                "confidence": best.confidence,
            }
        else:
            out[job.code] = None
    return out
