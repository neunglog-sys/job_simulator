"""data/jobs/*.yaml 조사 필드 회귀 테스트.

wagework.go.kr 수집 과정(docs/jobs/batch1_mapping_candidates.md)에서 확인된 함정을
데이터 계층에서도 막는다: status 오탈자, 그리고 "재직자 조사 자체가 없음(0/null)"과
"조사는 있지만 값이 0"을 구분하지 못하는 경우.
"""

import pytest

from app.content.loader import VALID_JOB_STATUS, _validate_job_research_fields, load_jobs


def _doc(**overrides):
    base = {"code": "test", "title": "테스트"}
    base.update(overrides)
    return base


def test_current_job_data_passes_validation():
    # data/jobs/*.yaml 실 데이터가 이 회귀 규칙을 어기지 않는지 확인 (load_jobs 내부에서 검증 호출됨)
    jobs = load_jobs()
    assert len(jobs) > 0


def test_all_declared_statuses_are_accepted():
    for status in VALID_JOB_STATUS:
        _validate_job_research_fields(_doc(status=status), "test.yaml")  # raise 없어야 함


def test_unknown_status_rejected():
    with pytest.raises(ValueError, match="status"):
        _validate_job_research_fields(_doc(status="approved"), "test.yaml")


def test_not_found_case_requires_null_reference_statistics():
    # 상세조사 데이터 없음(K000006012 등)은 reference_statistics 전체가 null이어야 함 — 통과
    doc = _doc(salary={"entry_level": {"min_krw": None, "max_krw": None}, "reference_statistics": None})
    _validate_job_research_fields(doc, "test.yaml")


def test_zero_median_with_reference_statistics_present_is_rejected():
    # avwgCnvAmt=0(조사 없음)을 median_annual_krw=0으로 잘못 옮기면 잡아야 함
    doc = _doc(
        salary={
            "entry_level": {"min_krw": None, "max_krw": None},
            "reference_statistics": {
                "median_annual_krw": 0,
                "statistic_type": "median",
                "population": "재직자 약 30명 설문조사",
                "reference_year": 2025,
            },
        }
    )
    with pytest.raises(ValueError, match="median_annual_krw"):
        _validate_job_research_fields(doc, "test.yaml")


def test_populated_reference_statistics_accepted():
    doc = _doc(
        salary={
            "entry_level": {"min_krw": None, "max_krw": None},
            "reference_statistics": {
                "median_annual_krw": 52500000,
                "statistic_type": "median",
                "population": "재직자 약 30명 설문조사",
                "reference_year": 2025,
            },
        }
    )
    _validate_job_research_fields(doc, "test.yaml")  # raise 없어야 함
