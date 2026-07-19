"""4단계 실무 미니게임 → 역량 블렌드 (팀 결정 B안).

계약: 시나리오 총점(미션 80% + 퀘스트 20%)은 팀 확정 공식이라 불변 — 미니게임은 역량 5종 중
해당 엔진이 강화하는 역량 하나에만 MINIGAME_BLEND만큼 섞인다. 스텁·모르는 엔진은 저장만 되고
점수·리포트에 반영되지 않는다(파이프라인은 돌되 가짜 점수가 오염시키지 않게).
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.domains.scoring.aggregate import (
    MINIGAME_BLEND,
    competency_scores,
    minigame_of,
)
from app.domains.simulation.service import save_minigame_result


class _Sim:
    state: dict = {}


def _save(payload):
    return asyncio.run(save_minigame_result(None, _Sim(), payload))


@pytest.mark.parametrize(
    "payload",
    [
        {},  # engine 없음
        {"engine": "  "},  # 빈 engine
        {"engine": "spot"},  # accuracy 없음
        {"engine": "spot", "accuracy": -1},
        {"engine": "spot", "accuracy": 101},
        {"engine": "spot", "accuracy": "90"},  # 문자열
        {"engine": "spot", "accuracy": True},  # bool은 숫자가 아니다
    ],
)
def test_save_rejects_invalid_payload(payload):
    with pytest.raises(HTTPException) as err:
        _save(payload)
    assert err.value.status_code == 400


def test_minigame_of_filters_unknown_and_invalid():
    # 스텁·모르는 엔진 → 반영 안 함 (프론트 빈 창이 engine:"stub"로 파이프라인만 태운다)
    assert minigame_of({"minigame": {"engine": "stub", "score": 100}}) is None
    assert minigame_of({"minigame": {"engine": "spot", "score": True}}) is None
    assert minigame_of({"minigame": "corrupt"}) is None
    assert minigame_of({}) is None
    assert minigame_of({"minigame": {"engine": "spot", "score": 80}}) is not None


def _missions():
    # 정상업무 → task_management 1.0 (미션 기반 task_management = 80)
    return [{"type": "정상업무", "adjusted": 80, "attempts": 1}]


def test_blend_into_single_competency():
    # pour → task_management. 80 * 0.75 + 100 * 0.25 = 85
    state = {"minigame": {"engine": "pour", "score": 100}}
    scores = competency_scores(_missions(), None, None, state)
    assert scores["task_management"] == round(80 * (1 - MINIGAME_BLEND) + 100 * MINIGAME_BLEND)
    # 다른 역량은 건드리지 않는다
    assert scores["situation_judgment"] is None


def test_blend_fills_empty_competency():
    # 미션 근거가 없는 역량이면 미니게임 점수가 그대로 (spot → situation_judgment)
    state = {"minigame": {"engine": "spot", "score": 70}}
    scores = competency_scores(_missions(), None, None, state)
    assert scores["situation_judgment"] == 70
    assert scores["task_management"] == 80  # 무관 역량 불변


def test_stub_engine_changes_nothing():
    state = {"minigame": {"engine": "stub", "score": 100}}
    assert competency_scores(_missions(), None, None, state) == competency_scores(
        _missions(), None, None, {}
    )


def test_total_formula_untouched():
    # 팀 확정 총점 공식 보존 — scenario_score는 minigame을 모른다
    from app.domains.scoring.aggregate import scenario_score

    steps = [{"id": "m1", "type": "정상업무"}]
    missions = {"m1": {"raw": 80, "max_hint": 0, "attempts": 1}}
    with_game = scenario_score(steps, missions, None)
    assert with_game["total"] == 80  # 미션 평균 80% + 퀘스트 대체 20% = 80
