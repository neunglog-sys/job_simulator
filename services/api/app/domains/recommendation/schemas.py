from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

from app.content.loader import yaml_scenario_slugs


class RecommendationRequest(BaseModel):
    consultation_id: int


class JobRecommendation(BaseModel):
    job_code: str
    job_title: str
    # 직무 자체에 대한 객관적 설명 (jobs.description) — reason(추천 사유)과 별개.
    # nullable인 이유: recommendations.results는 생성 시점 스냅샷이라, 이 필드 추가 이전에
    # 저장된 기존 행에는 값이 없다 — 필수로 두면 과거 추천 조회가 전부 500 난다.
    description: str | None = None
    score: int  # 0~100 적합도
    reason: str
    # NCS 조사자료(배치1) 원본 — F 직무군(f01~)엔 없음. 과거 J 추천 스냅샷 호환용으로 유지.
    education_requirement: dict | None = None
    salary: dict | None = None
    certifications: list = []
    scenario_slug: str | None = None
    # F 직무군 세부직업(조사 엑셀) — 이 필드 추가 이전 스냅샷엔 없으므로 기본 [].
    detail_jobs: list[str] = []

    @field_validator("scenario_slug")
    @classmethod
    def _only_active_scenarios(cls, v: str | None) -> str | None:
        # 스냅샷에 박제된 slug가 저장 이후 비활성(_disabled)됐을 수 있다 — 그대로 내리면
        # '직무 체험하기'가 404 데드엔드가 된다(레거시 추천 8건 실측). 모든 응답 경로가
        # 이 스키마를 거치므로 여기 한 곳에서 활성 YAML 기준으로 재검증하고, DB 행은
        # 건드리지 않는다(읽기 전용 방어).
        if v is not None and v not in yaml_scenario_slugs():
            return None
        return v


class RecommendationOut(BaseModel):
    id: int
    consultation_id: int
    results: list[JobRecommendation]
    feedback: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecommendationFeedbackRequest(BaseModel):
    feedback: Literal["helpful", "not_helpful"]
