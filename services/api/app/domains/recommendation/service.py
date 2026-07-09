"""직무 추천 — 상담 대화 LLM 구조화 추출 + Rule-based Scoring (설계서 §6-①).

1. 상담 대화 전체를 LLM에 넣어 역량 점수·관심사·강점·요약을 JSON으로 추출
2. 직무별 역량 매트릭스(data/jobs)와 가중 평균으로 적합도 계산 (룰 기반 — 결정적)
3. 상위 3개 직무 + 근거를 recommendations 테이블에 저장
"""

import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_competencies
from app.domains.consultation.service import get_owned_consultation, list_messages
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Job, Recommendation, User

logger = logging.getLogger(__name__)

TOP_N = 3
NEUTRAL_SCORE = 50  # 근거 부족 시 중립값
APTITUDE_CLARITY_MIN = 50  # 미달 시 추천 대신 추가 상담 유도 (중간 게이트)


def _extraction_schema(competency_keys: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "competency_scores": {
                "type": "object",
                "properties": {
                    k: {"type": "integer", "minimum": 0, "maximum": 100}
                    for k in competency_keys
                },
                "required": competency_keys,
                "additionalProperties": False,
            },
            "interests": {"type": "array", "items": {"type": "string"}},
            "strengths": {"type": "array", "items": {"type": "string"}},
            "summary": {"type": "string"},
            "aptitude_clarity": {"type": "integer"},
            "followup_questions": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "competency_scores",
            "interests",
            "strengths",
            "summary",
            "aptitude_clarity",
            "followup_questions",
        ],
        "additionalProperties": False,
    }


async def _extract_profile(session: AsyncSession, consultation: Consultation) -> dict:
    messages = await list_messages(session, consultation.id)
    if not messages:
        raise HTTPException(status_code=400, detail="상담 대화가 없어 추천할 수 없음")

    competencies = load_competencies()
    transcript = "\n".join(
        f"{'사용자' if m.role == 'user' else '상담사'}: {m.content}" for m in messages
    )
    system = render_prompt("recommendation/extract.md", competencies=competencies)
    return await get_llm().chat_json(
        [ChatMessage(role="user", content=f"## 상담 대화\n{transcript}")],
        system=system,
        json_schema=_extraction_schema([c["key"] for c in competencies]),
    )


def _score_job(job: Job, scores: dict[str, int]) -> int:
    """직무 역량 중요도(1~5) 가중 평균 → 0~100 적합도."""
    weights = job.competencies
    if not weights:
        return NEUTRAL_SCORE
    total = sum(
        scores.get(key, NEUTRAL_SCORE) * weight for key, weight in weights.items()
    )
    return round(total / (100 * sum(weights.values())) * 100)


def _build_reason(job: Job, scores: dict[str, int], names: dict[str, str]) -> str:
    """해당 직무에서 중요하면서(가중치) 사용자가 강한(점수) 역량 상위 2개로 근거 구성."""
    ranked = sorted(
        job.competencies.items(),
        key=lambda kv: kv[1] * scores.get(kv[0], NEUTRAL_SCORE),
        reverse=True,
    )
    top = [names.get(key, key) for key, _ in ranked[:2]]
    return f"{'·'.join(top)} 역량이 {job.title} 직무의 핵심 요구 역량과 잘 맞습니다."


async def create_recommendation(
    session: AsyncSession, user: User, consultation_id: int
) -> Recommendation:
    consultation = await get_owned_consultation(session, consultation_id, user)
    profile = await _extract_profile(session, consultation)

    # 중간 게이트: 적성 파악이 부족하면 추천하지 않고 추가 상담으로 유도.
    # "적성을 모른다"를 최종 리포트에서 통보하는 게 아니라 상담 단계에서 걸러 찾아가게 함.
    clarity = int(profile.get("aptitude_clarity", 0))
    if clarity < APTITUDE_CLARITY_MIN:
        consultation.summary = profile.get("summary")  # 중간 결론은 다음 상담 컨텍스트로
        await session.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "aptitude_unclear",
                "aptitude_clarity": clarity,
                "interim_conclusion": profile.get("summary"),
                "followup_questions": profile.get("followup_questions", []),
                "message": "적성 파악이 아직 부족해요. 아바타와 조금 더 이야기해보세요.",
            },
        )

    scores: dict[str, int] = profile.get("competency_scores") or {}
    names = {c["key"]: c["name"] for c in load_competencies()}

    jobs = list((await session.execute(select(Job))).scalars())
    ranked = sorted(jobs, key=lambda j: _score_job(j, scores), reverse=True)[:TOP_N]
    results = [
        {
            "job_code": job.code,
            "job_title": job.title,
            "score": _score_job(job, scores),
            "reason": _build_reason(job, scores, names),
        }
        for job in ranked
    ]

    recommendation = Recommendation(
        user_id=user.id, consultation_id=consultation.id, results=results
    )
    # 추출 요약을 상담 세션에 저장(Conversation Memory) + 상담 종료 처리
    consultation.summary = profile.get("summary")
    consultation.status = "completed"
    session.add(recommendation)
    await session.commit()
    await session.refresh(recommendation)
    logger.info(
        "추천 생성: consultation=%d, top=%s",
        consultation.id,
        [r["job_code"] for r in results],
    )
    return recommendation


async def get_recommendation(
    session: AsyncSession, recommendation_id: int, user: User
) -> Recommendation:
    rec = await session.get(Recommendation, recommendation_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status_code=404, detail="추천 결과를 찾을 수 없음")
    return rec
