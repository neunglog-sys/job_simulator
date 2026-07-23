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
from sqlalchemy.exc import IntegrityError
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
        raise HTTPException(status_code=400, detail="상담 후에 결과를 보실 수 있습니다.")

    competencies = load_competencies()
    transcript = "\n".join(
        f"{'사용자' if m.role == 'user' else '상담사'}: {m.content}" for m in messages
    )
    system = render_prompt("recommendation/extract.md", competencies=competencies)
    try:
        return await get_llm().chat_json(
            [ChatMessage(role="user", content=f"## 상담 대화\n{transcript}")],
            system=system,
            json_schema=_extraction_schema([c["key"] for c in competencies]),
        )
    except Exception as e:  # noqa: BLE001 — LLM 실패를 raw 500 대신 명확한 503으로
        logger.warning("추천 프로파일 추출 실패 (consultation=%d): %s", consultation.id, e)
        raise HTTPException(
            status_code=503,
            detail="추천 분석을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
        ) from e


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
    """추천 후보 자격 — 역량 가중치(competencies)나 8모듈 43축 가중치(dimension_weights)
    중 하나는 있어야 점수를 매길 수 있다.

    빈 competencies는 NEUTRAL_SCORE만 받아 진짜 추천이 아니므로 원래는 후보에서
    전부 제외했다. 다만 competencies가 비어있는 40개 카테고리 직무(kts/ms/ys/jm/
    stn/yg-*)는 module_mapping.json에서 이식된 dimension_weights를 갖고 있어
    (_score_job 참고) 이것으로 근거 있는 점수를 매길 수 있으므로 후보에 포함한다.
    둘 다 없는(순수 '플레이용') 직무만 여전히 배제된다.
    """
    return bool(job.competencies) or bool(job.dimension_weights)


def _module_interest_match(
    dimension_weights: dict[str, float], user_profile: dict[str, int]
) -> int | None:
    """dimension_weights의 interest.* 서브셋만 추출해 사용자 흥미유형과 코사인 매칭.

    work_target/work_style/skill 등 나머지 축 그룹은 사전 설문(RIASEC)에 대응하는
    사용자 신호가 없다 — NEUTRAL_SCORE로 채우면 근거 없는 점수를 만드는 것이므로,
    _weighted_avg처럼 채우지 않고 interest 그룹만으로 판단한다.
    """
    interest_weights = {
        key.removeprefix("interest."): weight
        for key, weight in dimension_weights.items()
        if key.startswith("interest.")
    }
    if not interest_weights:
        return None
    return _interest_match(interest_weights, user_profile)


def _score_job(job: Job, scores: dict[str, int], interest_profile: dict[str, int] | None = None) -> int:
    """직무 역량 중요도(1~5) 가중 평균 → 0~100 적합도. 사전 설문이 있으면 흥미유형 매칭을 보조 신호로 blend.

    competencies가 비어있는 카테고리 직무(dimension_weights만 있는 40개)는 역량 근거
    자체가 없으므로 이 블렌드 대신 dimension_weights의 interest.* 서브셋과 사전 설문의
    코사인 매칭 점수를 그대로 사용한다.
    """
    if job.competencies:
        competency_score = _weighted_avg(job.competencies, scores)
        if competency_score is None:
            competency_score = NEUTRAL_SCORE

        if not interest_profile:
            return competency_score
        interest_score = _interest_match(job.interest_profile, interest_profile)
        if interest_score is None:
            return competency_score
        return round(competency_score * (1 - INTEREST_WEIGHT) + interest_score * INTEREST_WEIGHT)

    if job.dimension_weights:
        if not interest_profile:
            return NEUTRAL_SCORE  # 사전 설문 자체가 없는 완전 무근거 케이스만 예외적으로 폴백
        module_score = _module_interest_match(job.dimension_weights, interest_profile)
        return module_score if module_score is not None else NEUTRAL_SCORE

    return NEUTRAL_SCORE


def _build_reason(
    job: Job,
    scores: dict[str, int],
    names: dict[str, str],
    interest_profile: dict[str, int] | None = None,
) -> str:
    """해당 직무에서 중요하면서(가중치) 사용자가 강한(점수) 역량 상위 2개로 근거 구성.

    사전 설문 흥미유형이 이 직무의 핵심 흥미유형과 겹치면 한 문장 덧붙임.
    competencies가 비어있는 카테고리 직무(dimension_weights만 있음)는 역량 근거가
    없으므로 별도 함수(_build_reason_from_dimension_weights)로 근거를 구성한다.
    """
    if not job.competencies:
        return _build_reason_from_dimension_weights(job, interest_profile)

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


def _build_reason_from_dimension_weights(
    job: Job, interest_profile: dict[str, int] | None
) -> str:
    """competencies 없이 dimension_weights만 있는 카테고리 직무의 근거 문구.

    상담 역량 점수 대신, 8모듈 43축 가중치의 interest.* 서브셋과 사전 설문에서
    가장 강하게 겹치는 흥미유형 이름으로 근거를 구성한다(_score_job과 동일한 신호).
    """
    interest_weights = {
        key.removeprefix("interest."): weight
        for key, weight in job.dimension_weights.items()
        if key.startswith("interest.")
    }
    if interest_weights and interest_profile:
        labels = survey.dimension_labels()
        top_dim = max(interest_weights.items(), key=lambda kv: kv[1])[0]
        label = labels.get(top_dim, top_dim)
        return f"사전 설문에서 나타난 '{label}' 성향이 {job.title} 직무와 잘 맞습니다."
    return f"{job.title} 직무는 관심 분야 체계(8모듈) 기준으로 추천되었습니다."


async def create_recommendation(
    session: AsyncSession, user: User, consultation_id: int
) -> Recommendation:
    consultation = await get_owned_consultation(session, consultation_id, user)

    # 멱등: 이 상담에 이미 추천이 있으면 그대로 돌려준다.
    # 매번 새로 만들면 ① LLM 프로필 추출이 매번 달라 추천 결과가 바뀌고(화면마다 다른 답)
    # ② 탭을 두 개 열거나 버튼을 두 번 누르면 행이 여러 개 쌓인다.
    # 추천은 "이 상담의 결론" 하나뿐이어야 리포트·체험 연결의 기준이 흔들리지 않는다.
    existing = await get_latest_recommendation(session, user, consultation_id)
    if existing is not None:
        return existing

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
            "description": job.description,
            "score": _score_job(job, scores, interest_profile),
            "reason": _build_reason(job, scores, names, interest_profile),
            # NCS 조사자료(배치1) — 미조사 직무는 내부 필드가 비어있을 수 있음
            "education_requirement": job.education_requirement,
            "salary": job.salary,
            "certifications": job.certifications,
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
    try:
        await session.commit()
    except IntegrityError:
        # 동시 요청(탭 두 개 등)이 유니크 제약에 걸린 경우 — 먼저 저장된 것을 돌려준다
        await session.rollback()
        winner = await get_latest_recommendation(session, user, consultation_id)
        if winner is not None:
            return winner
        raise
    await session.refresh(recommendation)
    logger.info(
        "추천 생성: consultation=%d, breakdown=%s",
        consultation.id,
        [
            {
                "job_code": job.code,
                # `or NEUTRAL_SCORE`는 정당한 0점을 falsy로 보고 50으로 바꿔 로그를 왜곡한다
                # (본계산 _score_job은 is None 비교라 정상). None만 중립값으로 치환한다.
                "competency_score": (
                    avg if (avg := _weighted_avg(job.competencies, scores)) is not None else NEUTRAL_SCORE
                ),
                "interest_score": (
                    _interest_match(job.interest_profile, interest_profile)
                    if interest_profile
                    else None
                ),
                # dimension_weights만 있는 카테고리 직무(40개)는 위 두 값이 의미 없으므로
                # 실제 채점에 쓰인 모듈-흥미유형 매칭 점수를 별도로 남긴다.
                "module_interest_score": (
                    _module_interest_match(job.dimension_weights, interest_profile)
                    if job.dimension_weights and interest_profile
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


async def get_latest_recommendation(
    session: AsyncSession, user: User, consultation_id: int
) -> Recommendation | None:
    await get_owned_consultation(session, consultation_id, user)
    return (
        await session.execute(
            select(Recommendation)
            .where(
                Recommendation.user_id == user.id,
                Recommendation.consultation_id == consultation_id,
            )
            .order_by(Recommendation.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def set_recommendation_feedback(
    session: AsyncSession, recommendation_id: int, user: User, feedback: str
) -> Recommendation:
    rec = await get_recommendation(session, recommendation_id, user)
    rec.feedback = feedback
    await session.commit()
    await session.refresh(rec)
    return rec
