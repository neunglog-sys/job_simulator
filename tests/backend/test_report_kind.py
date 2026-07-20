"""리포트 종류 구분 — 상담 결과 리포트 vs 직무 체험 최종 리포트 (팀 결정 2026-07-20).

두 리포트는 성격이 다르다:
  - 상담 결과 리포트: 상담만으로 낸 적합도
  - 직무 체험 최종 리포트: 상담 50% + 체험 수행 50%
같은 이름으로 쓰면 사용자가 "아까 본 리포트와 점수가 왜 다르지?"가 되므로,
응답에 종류를 실어 화면·문구를 구분할 수 있게 한다.
"""

from app.domains.reporting.schemas import ReportOut


def _report_out(**overrides) -> ReportOut:
    base = {
        "id": 1,
        "status": "done",
        "consultation_id": 10,
        "simulation_id": None,
        "fit_score": 72,
        "strengths": [],
        "improvements": [],
        "advice": None,
        "created_at": "2026-07-20T00:00:00",
    }
    return ReportOut(**{**base, **overrides})


def test_consult_report_kind():
    out = _report_out(simulation_id=None)
    assert out.kind == "consult"
    assert out.kind_label == "상담 결과 리포트"


def test_experience_report_kind():
    # 체험(시뮬레이션)을 함께 넘긴 리포트 = 최종 리포트
    out = _report_out(simulation_id=99)
    assert out.kind == "experience"
    assert out.kind_label == "직무 체험 최종 리포트"
