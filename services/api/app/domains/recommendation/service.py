"""직무 추천 — 상담 대화 LLM 구조화 추출 + Rule-based Scoring (설계서 §6-①).

1. 상담 대화 전체를 LLM에 넣어 역량 점수·관심사·강점·요약을 JSON으로 추출
2. 직무별 역량 매트릭스(data/jobs)와 가중 평균으로 적합도 계산 (룰 기반 — 결정적)
3. 사전 설문(RIASEC 흥미유형, Consultation.survey.profile)이 있으면 직무별 흥미유형
   가중치(Job.interest_profile)와 매칭해 역량 점수에 보조 신호로 blend (7:3)
4. 상위 5개 직무 + 근거를 recommendations 테이블에 저장
"""

import logging
import math

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.loader import load_competencies, load_job_scenario_map
from app.domains.consultation import survey
from app.domains.consultation.service import get_owned_consultation, list_messages
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.llm.prompts import render_prompt
from app.models import Consultation, Job, Recommendation, Scenario, User

logger = logging.getLogger(__name__)

TOP_N = 5
NEUTRAL_SCORE = 50  # 근거 부족 시 중립값
APTITUDE_CLARITY_MIN = 50  # 미달 시 추천 대신 추가 상담 유도 (중간 게이트)
INTEREST_WEIGHT = 0.3  # 흥미유형 매칭 반영 비중 (역량 점수가 주 신호, 설문은 보조 신호)


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


def _weighted_avg(weights: dict[str, int], scores: dict[str, int]) -> int | None:
    if not weights:
        return None
    total = sum(scores.get(key, NEUTRAL_SCORE) * weight for key, weight in weights.items())
    return round(total / (100 * sum(weights.values())) * 100)


def _interest_match(job_profile: dict[str, int], user_profile: dict[str, int]) -> int | None:
    """직무·사용자 흥미유형 벡터의 코사인 유사도 → 0~100.

    가중 평균이 아닌 이유: RIASEC 프로필은 사용자가 특정 유형에 0점을 주는 게 흔한데(그 유형에
    관심이 없다는 정상 신호), 가중 평균은 그 0점이 직무의 다른(비주력) 차원 가중치와 곱해지며
    전체 점수를 깎아버려 "주력 유형이 정확히 일치"해도 점수가 낮게 나오는 문제가 있었다.
    코사인 유사도는 방향(어느 유형이 두드러지는가)만 비교하므로 이 왜곡이 없다.
    """
    dims = set(job_profile) | set(user_profile)
    if not dims:
        return None
    job_norm = math.sqrt(sum(job_profile.get(d, 0) ** 2 for d in dims))
    user_norm = math.sqrt(sum(user_profile.get(d, 0) ** 2 for d in dims))
    if job_norm == 0 or user_norm == 0:
        return None
    dot = sum(job_profile.get(d, 0) * user_profile.get(d, 0) for d in dims)
    return round(max(dot / (job_norm * user_norm), 0) * 100)


def is_recommendable(job: Job) -> bool:
    """추천 후보 자격 — 역량 가중치가 있어야 점수를 매길 수 있다.

    빈 competencies는 NEUTRAL_SCORE만 받아 진짜 추천이 아니므로 후보에서 제외한다.
    게임 시나리오 전용으로 생성된 '플레이용' 직무(build_scenarios YAML 방출)가
    추천 상위에 섞이던 오염을 막는다. slug==code 관례에 의존하지 않는 판별.
    """
    return bool(job.competencies)


def _score_job(job: Job, scores: dict[str, int], interest_profile: dict[str, int] | None = None) -> int:
    """직무 역량 중요도(1~5) 가중 평균 → 0~100 적합도. 사전 설문이 있으면 흥미유형 매칭을 보조 신호로 blend."""
    competency_score = _weighted_avg(job.competencies, scores)
    if competency_score is None:
        competency_score = NEUTRAL_SCORE

    if not interest_profile:
        return competency_score
    interest_score = _interest_match(job.interest_profile, interest_profile)
    if interest_score is None:
        return competency_score
    return round(competency_score * (1 - INTEREST_WEIGHT) + interest_score * INTEREST_WEIGHT)


def _build_reason(
    job: Job,
    scores: dict[str, int],
    names: dict[str, str],
    interest_profile: dict[str, int] | None = None,
) -> str:
    """해당 직무에서 중요하면서(가중치) 사용자가 강한(점수) 역량 상위 2개로 근거 구성.

    사전 설문 흥미유형이 이 직무의 핵심 흥미유형과 겹치면 한 문장 덧붙임.
    """
    ranked = sorted(
        job.competencies.items(),
        key=lambda kv: kv[1] * scores.get(kv[0], NEUTRAL_SCORE),
        reverse=True,
    )
    top = [names.get(key, key) for key, _ in ranked[:2]]
    reason = f"{'·'.join(top)} 역량이 {job.title} 직무의 핵심 요구 역량과 잘 맞습니다."

    if interest_profile and job.interest_profile:
        labels = survey.dimension_labels()
        job_top_dim, job_top_weight = max(job.interest_profile.items(), key=lambda kv: kv[1])
        if job_top_weight >= 4 and interest_profile.get(job_top_dim, 0) >= 60:
            reason += f" 사전 설문에서 나타난 '{labels.get(job_top_dim, job_top_dim)}' 성향과도 잘 맞아요."
    return reason


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
    interest_profile: dict[str, int] = (consultation.survey or {}).get("profile") or {}

    jobs = [j for j in (await session.execute(select(Job))).scalars() if is_recommendable(j)]
    ranked = sorted(
        jobs, key=lambda j: _score_job(j, scores, interest_profile), reverse=True
    )[:TOP_N]
    scenario_map = load_job_scenario_map()  # 적성 → 체험 연결: 추천 직무의 근접 시나리오
    # 매핑 slug가 실제 존재하는 시나리오인지 확인 — 시나리오 rename/삭제로 map이 뒤처지면
    # '바로 체험하기'가 404 나거나 stale slug가 추천에 박제되므로, 존재하는 것만 남긴다.
    live_slugs = set((await session.execute(select(Scenario.slug))).scalars())
    results = [
        {
            "job_code": job.code,
            "job_title": job.title,
            "score": _score_job(job, scores, interest_profile),
            "reason": _build_reason(job, scores, names, interest_profile),
            # 프론트 '바로 체험하기' 버튼용 — 매핑 없거나 시나리오 부재면 null (버튼 숨김)
            "scenario_slug": (
                slug if (slug := scenario_map.get(job.code)) in live_slugs else None
            ),
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
        "추천 생성: consultation=%d, breakdown=%s",
        consultation.id,
        [
            {
                "job_code": job.code,
                "competency_score": _weighted_avg(job.competencies, scores) or NEUTRAL_SCORE,
                "interest_score": (
                    _interest_match(job.interest_profile, interest_profile)
                    if interest_profile
                    else None
                ),
                "blended_score": result["score"],
            }
            for job, result in zip(ranked, results)
        ],
    )
    return recommendation


async def get_recommendation(
    session: AsyncSession, recommendation_id: int, user: User
) -> Recommendation:
    rec = await session.get(Recommendation, recommendation_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status_code=404, detail="추천 결과를 찾을 수 없음")
    return rec


async def set_recommendation_feedback(
    session: AsyncSession, recommendation_id: int, user: User, feedback: str
) -> Recommendation:
    rec = await get_recommendation(session, recommendation_id, user)
    rec.feedback = feedback
    await session.commit()
    await session.refresh(rec)
    return rec
