"""scripts/build_scenarios — 변환기 순수 함수 (분류·정규화·criteria·slug·메커니즘)."""

from app.domains.scoring.service import grade_structured
from app.models import TeamMission
from app.scripts.build_scenarios import (
    build_task,
    classify,
    mission_npcs,
    norm_role,
    split_action_steps,
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
    success = "기준1, 기준2, 기준3, 기준4, 기준5, 기준6"  # 최대 4개로 잘림
    out = split_criteria(success, "임의 처리 금지")
    assert len(out) == 5  # 성공 4 + 실패패턴 1
    assert out[-1].startswith("흔한 실수를 피했는가")  # 실패패턴 기준 보장


def test_split_criteria_empty_success_fallback():
    out = split_criteria("", None)
    assert out == ["미션 요구사항을 충족했는가"]


def test_split_action_steps_circled_markers():
    assert split_action_steps("① 대조 ② 표기 ③ 안내") == ["대조", "표기", "안내"]
    assert split_action_steps("마커 없는 문장") == []  # write 폴백 신호
    assert split_action_steps(None) == []


# ── 라이트 메커니즘 (build_task) — 상황유형별 인터랙션 조립 ─────────────

def _m(**kw) -> TeamMission:
    base = {
        "mission_code": "TST-01", "mission": "테스트 미션", "outputs": "산출물",
        "action_steps": "① 첫단계 ② 둘째 ③ 셋째 ④ 넷째",
        "failure_patterns": "흔한실수A, 흔한실수B", "success_criteria": "성공1, 성공2",
    }
    base.update(kw)
    return TeamMission(**base)


def test_build_task_normal_is_checklist():
    task = build_task(_m(situation_type="정상업무"))
    assert task["kind"] == "checklist"
    keys = {o["key"] for o in task["options"]}
    assert set(task["answer"]["keys"]) <= keys  # 정답 key는 보기 안에
    assert set(task["answer"]["keys"]) & {o["key"] for o in task["options"]}


def test_build_task_missing_info_is_single_choice():
    task = build_task(_m(situation_type="자료·정보 누락"))
    assert task["kind"] == "choice"
    assert task["answer"]["key"] in {o["key"] for o in task["options"]}


def test_build_task_priority_is_order_and_not_presorted():
    task = build_task(_m(situation_type="우선순위 충돌"))
    assert task["kind"] == "order"
    display = [o["key"] for o in task["options"]]
    assert display != task["answer"]["keys"]  # 표시 순서가 정답이면 유출 — 회전됨
    assert set(display) == set(task["answer"]["keys"])


def test_build_task_safety_is_first_response_choice():
    task = build_task(_m(situation_type="오류·안전위험"))
    assert task["kind"] == "choice"
    assert task["answer"]["key"] in {o["key"] for o in task["options"]}


def test_build_task_report_is_write():
    task = build_task(_m(situation_type="보고·인계"))
    assert task["kind"] == "write"
    assert "options" not in task
    assert "💡" not in task["prompt"]  # 분량 안내 문구 없음


def test_build_task_falls_back_to_write_without_steps():
    # action_steps에 마커가 없으면 보기를 조립할 수 없음 → write
    task = build_task(_m(situation_type="정상업무", action_steps="줄글 설명"))
    assert task["kind"] == "write"


def test_build_task_deterministic_shuffle():
    # 같은 mission_code면 보기 순서가 재변환해도 동일 (멱등)
    a = build_task(_m(situation_type="정상업무"))
    b = build_task(_m(situation_type="정상업무"))
    assert [o["label"] for o in a["options"]] == [o["label"] for o in b["options"]]


# ── 룰 채점 (grade_structured) ────────────────────────────────────────

def test_grade_choice_correct_and_wrong():
    task = {"kind": "choice", "pass_score": 70, "criteria": ["판단"],
            "options": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}],
            "answer": {"key": "a"}}
    assert grade_structured(task, "a")["passed"] is True
    assert grade_structured(task, "b")["passed"] is False
    assert grade_structured(task, ["a"])["total"] == 100  # 배열 형식도 허용


def test_grade_checklist_partial_and_penalty():
    task = {"kind": "checklist", "pass_score": 70, "criteria": ["행동"],
            "options": [{"key": k, "label": k} for k in "abcd"],
            "answer": {"keys": ["a", "b", "c"]}}
    assert grade_structured(task, "a,b,c")["total"] == 100
    assert grade_structured(task, "a,b")["total"] == 67  # 3개 중 2개
    assert grade_structured(task, "a,b,c,d")["total"] == 70  # 오답 1개 → 30 감점


def test_grade_order_concordance():
    task = {"kind": "order", "pass_score": 70, "criteria": ["순서"],
            "options": [{"key": k, "label": k} for k in "abc"],
            "answer": {"keys": ["a", "b", "c"]}}
    assert grade_structured(task, "a,b,c")["total"] == 100
    assert grade_structured(task, "c,b,a")["total"] == 0  # 완전 역순
    # 인접 한 쌍만 뒤집힘 (a,c,b) → 3쌍 중 2쌍 일치
    assert grade_structured(task, "a,c,b")["total"] == 67


def test_grade_rejects_invalid_keys():
    import pytest
    from fastapi import HTTPException
    task = {"kind": "choice", "pass_score": 70, "criteria": ["판단"],
            "options": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}],
            "answer": {"key": "a"}}
    with pytest.raises(HTTPException):
        grade_structured(task, "z")  # 없는 보기
    with pytest.raises(HTTPException):
        grade_structured(task, "")  # 빈 제출
    with pytest.raises(HTTPException):
        grade_structured(task, "a,b")  # 단일 선택에 복수 제출 — 조용한 0점 대신 400


def test_grade_malformed_task_raises_500_not_dead_end():
    # 보기·정답 누락(손상 과제)은 무한 400 dead-end 대신 서버오류로 시끄럽게
    import pytest
    from fastapi import HTTPException
    broken = {"kind": "choice", "pass_score": 70, "criteria": ["판단"],
              "options": [], "answer": {}}
    with pytest.raises(HTTPException) as ei:
        grade_structured(broken, "a")
    assert ei.value.status_code == 500


def test_public_state_masks_pending_quest():
    from app.domains.simulation.service import public_state
    masked = public_state({"step": "m1", "quest": {"status": "pending", "attempts": 0}})
    assert masked["quest"]["status"] == "none"  # 미발동 퀘스트 존재를 숨김
    # 발동 후(active)는 재접속 UX 위해 노출
    active = public_state({"step": "m1", "quest": {"status": "active", "attempts": 1}})
    assert active["quest"]["status"] == "active"


def test_resolve_step_heals_dangling_step():
    from types import SimpleNamespace
    from app.domains.simulation.service import _resolve_step
    scenario = SimpleNamespace(slug="x", steps=[{"id": "m1", "title": "t", "mission": "m"}])
    state = {"step": "m9"}  # 재생성으로 사라진 스텝
    step = _resolve_step(scenario, state)
    assert step["id"] == "m1" and state["step"] == "m1"  # 첫 스텝으로 복구


def test_validate_task_rejects_single_item_order():
    # 항목 1개짜리 order는 비교쌍이 없어 항상 0점 — 손편집 실수를 로드 시점에 차단
    import pytest
    from app.content.loader import _validate_task
    task = {"kind": "order", "prompt": "p", "criteria": ["c"], "on_pass": "__end__",
            "options": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}],
            "answer": {"keys": ["a"]}}
    with pytest.raises(ValueError, match="2개 이상"):
        _validate_task(task, "테스트")
