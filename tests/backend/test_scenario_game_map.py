"""scenario_map — 시나리오 → 게임 맵 매핑 무결성.

매핑은 시나리오 미션 내용으로 검증해 손으로 관리하는 파일이라, 시나리오가 추가되거나
slug가 바뀌면 조용히 어긋나기 쉽다 → 참조 무결성을 여기서 강제한다.
(맵 폴더 존재 여부는 컨테이너에 maps/가 없어 검사 불가 — 폴더명 오타는 호스트에서 확인)
"""

from pathlib import Path

import yaml

from app.content.loader import load_scenarios

MAP_FILE = Path("data/maps/scenario_map.yaml")


def _mapping() -> dict:
    return yaml.safe_load(MAP_FILE.read_text(encoding="utf-8"))


def test_mapping_keys_are_existing_scenario_slugs():
    scenarios, _ = load_scenarios()
    slugs = {s["slug"] for s in scenarios}
    bad = [k for k in _mapping() if k not in slugs]
    assert not bad, f"존재하지 않는 시나리오 slug: {bad}"


def test_every_scenario_has_a_mapping_entry():
    # 맵이 아직 없으면 null로라도 등재 — 새 시나리오가 매핑에서 조용히 빠지는 것 방지
    scenarios, _ = load_scenarios()
    missing = {s["slug"] for s in scenarios} - set(_mapping())
    assert not missing, f"매핑에 누락된 시나리오: {sorted(missing)} (맵 없으면 null로 추가)"


def test_no_two_scenarios_share_a_map():
    # 맵과 시나리오는 1:1 — 같은 맵을 두 시나리오가 쓰면 배정 실수일 가능성이 높다
    assigned = [v for v in _mapping().values() if v]
    dupes = {m for m in assigned if assigned.count(m) > 1}
    assert not dupes, f"두 시나리오에 배정된 맵: {dupes}"
