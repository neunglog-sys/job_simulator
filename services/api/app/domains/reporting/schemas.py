from datetime import datetime

from pydantic import BaseModel, model_validator


class ReportCreate(BaseModel):
    consultation_id: int
    simulation_id: int | None = None  # 완주한 시뮬레이션 — 있으면 수행 점수 50% 반영


class ReportOut(BaseModel):
    id: int
    status: str  # pending | done | failed
    consultation_id: int | None
    simulation_id: int | None
    # 두 리포트는 성격이 다르다 — 화면·문구를 구분해 쓰라고 종류를 함께 내려준다.
    #   consult    = 상담 결과 리포트 (상담만으로 낸 적합도)
    #   experience = 직무 체험 최종 리포트 (상담 50% + 체험 수행 50%)
    kind: str = "consult"
    kind_label: str = "상담 결과 리포트"

    @model_validator(mode="after")
    def _derive_kind(self):
        if self.simulation_id is not None:
            self.kind = "experience"
            self.kind_label = "직무 체험 최종 리포트"
        return self
    fit_score: int | None
    strengths: list
    improvements: list
    advice: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
