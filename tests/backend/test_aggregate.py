"""scoring/aggregate — 정밀 점수제 집계 (자력 보정·총점·역량 매핑)."""

from app.domains.scoring.aggregate import (
    adjusted_score,
    collect_from_logs,
    competency_scores,
    scenario_score,
)

STEPS = [
    {"id": "s1", "type": "정상업무"},
    {"id": "s2", "type": "자료·정보 누락"},
    {"id": "s3", "type": "보고·인계"},
]


def _log(type_, **payload):
    return {"type": type_, "payload": payload}


def test_adjusted_score_self_reliance():
    assert adjusted_score(90, 0) == 90   # 힌트 없이 → 그대로
    assert adjusted_score(90, 1) == 81   # 힌트1 ×0.9
    assert adjusted_score(90, 2) == 72   # 힌트2 ×0.8
    assert adjusted_score(90, 3) == 63   # 정답 가이드 ×0.7
    assert adjusted_score(90, 7) == 63   # 상한 클램프


def test_collect_tracks_max_hint_before_pass():
    logs = [
        _log("task_submit", step="s1", attempt=1, total=50, passed=False, hint_level=1),
        _log("task_submit", step="s1", attempt=2, total=55, passed=False, hint_level=2),
        _log("task_submit", step="s1", attempt=3, total=85, passed=True, hint_level=0),
    ]
    missions, quest = collect_from_logs(logs)
    assert missions["s1"] == {"raw": 85, "max_hint": 2, "attempts": 3}
    assert quest is None


def test_scenario_score_weights_80_20():
    logs = [
        _log("task_submit", step="s1", attempt=1, total=80, passed=True),
        _log("task_submit", step="s2", attempt=1, total=90, passed=True),
        _log("quest_submit", attempt=1, total=70, passed=True),
    ]
    missions, quest = collect_from_logs(logs)
    score = scenario_score(STEPS, missions, quest)
    assert score["mission_avg"] == 85          # (80+90)/2
    assert score["quest"]["adjusted"] == 70
    assert score["total"] == round(85 * 0.8 + 70 * 0.2)  # 82


def test_quest_failed_scores_zero():
    logs = [
        _log("task_submit", step="s1", attempt=1, total=80, passed=True),
        _log("quest_submit", attempt=1, total=40, passed=False),
        _log("quest_submit", attempt=2, total=50, passed=False),
    ]
    missions, quest = collect_from_logs(logs)
    score = scenario_score(STEPS, missions, quest)
    assert score["quest"]["adjusted"] == 0
    assert score["total"] == round(80 * 0.8)   # 돌발 0점 반영


def test_quest_not_fired_substituted_by_mission_avg():
    logs = [_log("task_submit", step="s1", attempt=1, total=80, passed=True)]
    missions, quest = collect_from_logs(logs)
    score = scenario_score(STEPS, missions, quest)
    assert score["quest"] is None
    assert score["total"] == 80                # 미발동 — 미션 평균으로 대체 (운 불이익 없음)


def test_competency_mapping_and_state_blend():
    mission_rows = [
        {"step": "s1", "type": "정상업무", "adjusted": 80},
        {"step": "s3", "type": "보고·인계", "adjusted": 90},
    ]
    state = {"step": "s3", "trust": 60, "schedule_stability": 70, "requirement_clarity": 50}
    comps = competency_scores(mission_rows, None, None, state)
    assert comps["task_management"] == 80          # 정상업무 주역량
    # 커뮤니케이션 = 보고인계 90 × 0.7 + 상태평균 60 × 0.3 = 81
    assert comps["communication"] == 81
    # 협업 = 보조(보고인계 90) × 0.7 + 상태평균 60 × 0.3 = 81
    assert comps["collaboration"] == 81
    assert comps["situation_judgment"] is None     # 해당 미션 없음


def test_first_pass_wins_no_retroactive_penalty():
    # 통과 후 재제출(실패·낮은 점수 재통과)이 확정 점수를 소급 오염하면 안 됨
    logs = [
        _log("task_submit", step="s1", attempt=1, total=90, passed=True),
        _log("task_submit", step="s1", attempt=2, total=30, passed=False, hint_level=3),
        _log("task_submit", step="s1", attempt=3, total=50, passed=True),
    ]
    missions, _ = collect_from_logs(logs)
    assert missions["s1"] == {"raw": 90, "max_hint": 0, "attempts": 1}


def test_bool_state_excluded_from_blend():
    # bool은 int 서브클래스 — True가 1로 평균에 섞여 블렌드를 오염하면 안 됨
    rows = [{"step": "s3", "type": "보고·인계", "adjusted": 90}]
    state = {"step": "s3", "trust": 60, "escalated": True}
    comps = competency_scores(rows, None, None, state)
    assert comps["communication"] == 81  # 90*0.7 + 60*0.3 (True 제외)


def test_engine_counters_do_not_pollute_competency_scores():
    """coach_streak 같은 엔진 카운터가 상태값 평균에 섞이면 역량 점수가 왜곡된다.

    실측으로 81 → 77까지 내려갔다. 기존 테스트 픽스처에 그 키가 없어 안 잡혔다.
    """
    from app.domains.scoring import aggregate

    missions = [{"type": "report", "adjusted": 80.0}]
    scenario_state = {"trust": 80, "rapport": 80}

    clean = aggregate.competency_scores(missions, None, None, dict(scenario_state))
    # 엔진 진행 정보가 들어와도 역량 점수는 그대로여야 한다.
    # (minigame은 의도적으로 반영되는 값이라 여기서 제외 — 카운터류만 본다)
    polluted = aggregate.competency_scores(
        missions, None, None,
        {**scenario_state, "coach_streak": 3, "score": 0, "step": "s1", "attempts": {}},
    )
    assert clean == polluted

    # 고치기 전에는 coach_streak가 0~100 점수로 오인돼 평균을 끌어내렸다
    assert clean["collaboration"] is not None and clean["collaboration"] >= 80
