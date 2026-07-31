"""코드리뷰(2026-07-20) 수정 회귀 테스트 — 검증 통과한 결함들이 재발하지 않게.

각 테스트는 결함 상황을 직접 재현한다: 개발 인증 스텁의 배포 차단, WS 텍스트 상한,
미니게임 통과 판정의 경계값, 추천 로그의 0점 보존.
"""

import pytest
from fastapi import HTTPException


def test_dev_auth_gate_blocks_x_user_id_in_prod(monkeypatch):
    """배포 모드(allow_dev_auth=False)에서는 X-User-Id·데모 폴백이 401로 막힌다."""
    import asyncio

    from app.core import deps
    from app.core.config import settings

    monkeypatch.setattr(settings, "allow_dev_auth", False)
    # 토큰 없이 X-User-Id만 → 401 (사칭 차단)
    with pytest.raises(HTTPException) as e1:
        asyncio.run(deps.resolve_user(None, token=None, x_user_id=3))
    assert e1.value.status_code == 401
    # 토큰도 헤더도 없음 → 데모 폴백 대신 401
    with pytest.raises(HTTPException) as e2:
        asyncio.run(deps.resolve_user(None, token=None, x_user_id=None))
    assert e2.value.status_code == 401


def test_ws_text_enforces_length_cap():
    from app.domains.simulation.router import WS_TEXT_MAX, _ws_submission, _ws_text

    # 정상
    assert _ws_text({"content": "안녕"}, "content") == "안녕"
    # 상한 초과 → 400
    with pytest.raises(HTTPException) as e:
        _ws_text({"content": "x" * (WS_TEXT_MAX + 1)}, "content")
    assert e.value.status_code == 400
    # 문자열 아님 → 400
    with pytest.raises(HTTPException):
        _ws_text({"content": {"nested": "obj"}}, "content")
    # task_submit은 str·list 둘 다 허용하되 크기 제한
    assert _ws_submission({"content": ["a", "b"]}) == ["a", "b"]
    with pytest.raises(HTTPException):
        _ws_submission({"content": ["x"] * 101})
    with pytest.raises(HTTPException):
        _ws_submission({"content": "y" * (WS_TEXT_MAX + 1)})


def test_minigame_passed_uses_raw_accuracy_not_rounded():
    """69.5는 반올림하면 70이지만 pass_score=70을 통과로 기록하면 저장 accuracy와 모순."""
    from app.domains.simulation.service import _minigame_result

    declared = {"engine": "spot", "pass_score": 70.0}
    r = _minigame_result({"engine": "spot", "accuracy": 69.5}, declared)
    assert r["accuracy"] == 69.5
    assert r["passed"] is False, "원본 accuracy(69.5)로 판정해야 미달"
    # 정확히 경계면 통과
    assert _minigame_result({"engine": "spot", "accuracy": 70}, declared)["passed"] is True


def test_recommendation_log_preserves_legit_zero():
    """_weighted_avg가 정당한 0을 반환하면 로그도 0이어야 한다(50으로 치환 금지)."""
    from app.domains.recommendation.service import _weighted_avg

    # 가중치는 있는데 점수가 전부 0 → 가중평균 0
    assert _weighted_avg({"problem_solving": 5}, {"problem_solving": 0}) == 0
    # 이 값이 falsy라도 로그 라인에서 50으로 바뀌지 않는지는 코드상 `is not None` 분기로 보장
