"""돌발 퀘스트 텍스트 개인화 — 원본 가명이 그대로 나가지 않는지.

sns-01 원본은 주인공을 '지수 씨'라는 고정 가명으로 부른다. 본편 mission은
_personalize_text로 로그인 사용자 호칭으로 바꿔 내보내는데, 돌발 퀘스트는 그
경로를 타지 않아 NPC가 사용자를 남의 이름으로 부르고 있었다(2026-07-28 E2E).
"""

from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from app.core.config import settings
from app.domains.simulation import service


def _quest(slug: str) -> dict:
    path = Path(settings.data_dir) / "scenarios" / f"{slug}.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data.get("sudden_quest") or {}


def test_sns01_quest_still_uses_the_placeholder_name():
    """전제 확인 — 원본에 가명이 남아 있어야 이 테스트가 의미를 가진다."""
    quest = _quest("sns-01")
    assert quest, "sns-01에 돌발 퀘스트가 없다 — 테스트 갱신 필요"
    assert "지수" in str(quest), "원본에서 가명이 사라졌다면 이 테스트는 정리해도 된다"


def test_public_quest_personalizes_intro_and_prompt():
    quest = _quest("sns-01")
    scenario = SimpleNamespace(slug="sns-01", sudden_quest=quest)
    published = service._public_quest(quest, "박민우", scenario, {"player_name": "김태수"})

    assert "지수" not in str(published), f"가명이 그대로 나갔다: {published}"
    assert "김태수" in (published["intro"] or "")


def test_public_quest_without_scenario_keeps_raw_text():
    """scenario를 안 넘기면 기존 동작 그대로 — 호출부를 강제로 깨뜨리지 않는다."""
    quest = _quest("sns-01")
    published = service._public_quest(quest, "박민우")
    assert published["intro"] == quest.get("intro")


@pytest.mark.parametrize("player, expected", [("김태수", "김태수님"), ("", "담당자님")])
def test_personalize_uses_player_address(player, expected):
    scenario = SimpleNamespace(slug="sns-01")
    out = service._personalize_text(scenario, {"player_name": player}, "지수 씨, 확인 부탁해요")
    assert out.startswith(expected)


def test_personalize_leaves_other_scenarios_alone():
    """가명 치환은 sns-01 전용 — 다른 시나리오 문장을 건드리면 안 된다."""
    scenario = SimpleNamespace(slug="kts-03")
    text = "지수 씨에게 전달하세요"
    assert service._personalize_text(scenario, {"player_name": "김태수"}, text) == text
