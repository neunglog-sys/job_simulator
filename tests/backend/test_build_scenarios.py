"""scripts/build_scenarios — 변환기 순수 함수 (분류·정규화·criteria·slug)."""

from app.scripts.build_scenarios import (
    classify,
    mission_npcs,
    norm_role,
    split_criteria,
)


def test_classify_rank_beats_customer_keyword():
    # '고객지원 팀장'은 응대 대상이 아니라 상사 — 직급 키워드 우선
    assert classify("고객지원 팀장") == "supervisor"
    assert classify("선임 정비사") == "mentor"
    assert classify("고령 환자") == "counterpart"
    assert classify("데이터 엔지니어") == "colleague"  # 미분류 기본값


def test_norm_role_strips_parenthetical():
    assert norm_role("고령 환자(보호자 동반)") == "고령 환자"
    assert norm_role("  김반장 (검수권자) ") == "김반장"
    assert norm_role(None) == ""


def test_mission_npcs_comma_split():
    assert mission_npcs("원무팀장, 수간호사(선임)") == ["원무팀장", "수간호사"]
    assert mission_npcs(None) == []


def test_split_criteria_failure_never_truncated():
    success = "기준1, 기준2, 기준3, 기준4, 기준5, 기준6"  # 라이트 난이도 — 2개로 잘림
    out = split_criteria(success, "임의 처리 금지")
    assert len(out) == 3
    assert out[-1].startswith("흔한 실수를 피했는가")  # 실패패턴 기준 보장


def test_split_criteria_empty_success_fallback():
    out = split_criteria("", None)
    assert out == ["미션 요구사항을 충족했는가"]
