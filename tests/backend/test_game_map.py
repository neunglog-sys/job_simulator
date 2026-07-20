"""content/game_map — 시나리오→맵 정보 + NPC 자리(spawn slot) 배정.

코드리뷰가 잡은 실패 시나리오들의 회귀 테스트 포함:
한글 spawn id 정규화 / 실패 비캐싱 / role이 rank보다 우선 / location 데이터 우선 /
맵별 가용 자리 / URL 인코딩 / 깨진 yaml 방어 / map_id·map 신호 일치.
"""

import json

import pytest

from app.content import game_map
from app.content.loader import read_yaml_map
from app.core.config import settings


@pytest.fixture(autouse=True)
def _fresh_caches():
    game_map.clear_caches()
    yield
    game_map.clear_caches()


def test_mapping_loads_and_filters_null():
    m = game_map.load_scenario_game_map()
    assert m, "scenario_map.yaml이 비어 있음"
    assert all(v for v in m.values()), "null 항목이 걸러지지 않음"
    assert "gm-01" in m


def test_map_info_for_mapped_scenario():
    info = game_map.map_info_for("gm-01")
    assert info is not None, "maps/ 볼륨이 컨테이너에 마운트됐는지 확인 (compose)"
    assert info["background"].startswith("/maps/")
    geo = info["geometry"]
    assert geo["walkable"] and geo["collision"] and geo["spawns"]
    assert any(s["id"] == "player" for s in geo["spawns"])


def test_map_info_none_for_unmapped():
    assert game_map.map_info_for("ms-03") is None  # 맵 미정(null) 시나리오
    assert game_map.map_info_for("없는-slug") is None


def test_korean_spawn_ids_normalized():
    # 리뷰 #1: 일부 맵은 spawn이 한글(팀장/사수/부장) — 로드 시 표준 id로 정규화돼야 함
    info = game_map.map_info_for("ms-01")  # 현대 문서 및 기록 관리 사무실 (한글 spawn 맵)
    assert info is not None
    ids = {s["id"] for s in info["geometry"]["spawns"]}
    assert "팀장" not in ids and "사수" not in ids and "부장" not in ids
    assert {"teamjang", "sasu", "bujang", "player"} <= ids


def test_all_completed_maps_use_standard_spawn_ids():
    # 전 맵 계약 검증 — NPC spawn 배정값이 geometry.spawns에서 항상 찾아지는지
    resolved = 0
    for slug in game_map.load_scenario_game_map():
        info = game_map.map_info_for(slug)
        if info is None:
            continue
        resolved += 1
        ids = {s["id"] for s in info["geometry"]["spawns"]}
        unknown = ids - set(game_map.NPC_SLOTS) - {"player"}
        assert not unknown, f"{slug}: 표준 밖 spawn id {unknown}"
    assert resolved >= 30


def test_background_url_is_percent_encoded():
    # 리뷰 #7: 폴더명에 공백·한글 — URL은 퍼센트 인코딩돼야 함
    info = game_map.map_info_for("stn-05")  # '현대 UX 전략 전쟁실' (공백 포함)
    assert info is not None
    assert " " not in info["background"]
    assert info["background"].startswith("/maps/%")


def test_missing_geometry_not_cached_appears_later(tmp_path, monkeypatch):
    # 리뷰 #3: 파일 없음이 캐싱되면 배포 후 업로드해도 map:null 고정 — 없어야 함
    monkeypatch.setattr(settings, "maps_dir", str(tmp_path))
    game_map.clear_caches()
    assert game_map.map_info_for("gm-01") is None  # 아직 파일 없음

    folder = tmp_path / game_map.load_scenario_game_map()["gm-01"]
    folder.mkdir(parents=True)
    (folder / "geometry.json").write_text(json.dumps({
        "background": "bg.png", "walkable": [{"x": 0, "y": 0, "w": 10, "h": 10}],
        "collision": [{"x": 1, "y": 1, "w": 1, "h": 1}],
        "spawns": [{"id": "player", "x": 1, "y": 1}],
    }), encoding="utf-8")
    assert game_map.map_info_for("gm-01") is not None  # 재시작 없이 즉시 반영


def test_available_map_id_gated_on_geometry(tmp_path, monkeypatch):
    # 리뷰 #4: /api/scenarios의 map_id는 geometry가 실제로 로드될 때만
    assert game_map.available_map_id("gm-01")  # 실제 맵 존재
    assert game_map.available_map_id("ms-03") is None  # 매핑 자체가 null
    monkeypatch.setattr(settings, "maps_dir", str(tmp_path))  # 매핑은 있는데 파일 없음
    game_map.clear_caches()
    assert game_map.available_map_id("gm-01") is None


def test_read_yaml_map_survives_broken_file(tmp_path):
    # 리뷰 #5: 깨진 매핑 yaml이 API를 500으로 브릭하면 안 됨
    bad = tmp_path / "bad.yaml"
    bad.write_text("key: [unclosed", encoding="utf-8")
    assert read_yaml_map(bad) == {}
    lst = tmp_path / "list.yaml"
    lst.write_text("- a\n- b\n", encoding="utf-8")
    assert read_yaml_map(lst) == {}
    assert read_yaml_map(tmp_path / "없는파일.yaml") == {}


def test_spawn_role_beats_rank():
    # 리뷰 #6: gm-01 실데이터 — role='사수', rank='구매팀장'은 사수 자리여야 함
    npcs = [
        {"npc_id": "a", "role": "사수", "rank": "구매팀장"},
        {"npc_id": "b", "role": "동료", "rank": "물류창고 담당 주임"},
        {"npc_id": "c", "role": "외부 협력사", "rank": "대성패키징 영업부장"},
    ]
    slots = game_map.assign_spawn_slots(npcs)
    assert slots["a"] == "sasu"
    assert slots["c"] == "bujang"
    assert slots["b"] == "teamjang"  # 남은 자리


def test_spawn_location_data_wins_over_keywords():
    # appearance.location이 있으면 추론보다 우선 (한글 값도 정규화)
    npcs = [
        {"npc_id": "a", "role": "사수", "rank": None, "location": "bujang"},
        {"npc_id": "b", "role": "팀장", "rank": None, "location": "팀장"},
    ]
    slots = game_map.assign_spawn_slots(npcs)
    assert slots["a"] == "bujang"
    assert slots["b"] == "teamjang"


def test_spawn_respects_available_slots():
    # 리뷰 #1(stn-02): 자리가 2개뿐인 맵에서는 그 자리들만 배정
    npcs = [
        {"npc_id": "a", "role": "팀장", "rank": None},
        {"npc_id": "b", "role": "사수", "rank": None},
        {"npc_id": "c", "role": "고객", "rank": None},
    ]
    slots = game_map.assign_spawn_slots(npcs, slots=("sasu", "bujang"))
    assert set(slots.values()) <= {"sasu", "bujang"}  # teamjang은 이 맵에 없음
    assert slots["b"] == "sasu"


def test_npc_slots_in_reads_map_slots():
    geo = {"spawns": [{"id": "player"}, {"id": "sasu"}, {"id": "bujang"}]}
    assert game_map.npc_slots_in(geo) == ("sasu", "bujang")
    assert game_map.npc_slots_in({"spawns": [{"id": "player"}]}) == game_map.NPC_SLOTS


def test_spawn_overflow_cycles():
    npcs = [{"npc_id": f"n{i}", "role": "", "rank": None} for i in range(5)]
    slots = game_map.assign_spawn_slots(npcs)
    assert len(slots) == 5
    assert all(s in game_map.NPC_SLOTS for s in slots.values())


def test_five_slot_map_seats_five_npcs_without_doubling():
    # 맵 리메이크 규격 v2 — npc4·npc5 spawn을 찍은 맵은 5명이 전부 다른 자리에 앉는다
    geo = {"spawns": [{"id": s} for s in ("player", "teamjang", "sasu", "bujang", "npc4", "npc5")]}
    slots = game_map.npc_slots_in(geo)
    assert slots == ("teamjang", "sasu", "bujang", "npc4", "npc5")
    npcs = [
        {"npc_id": "a", "role": "팀장", "rank": None},
        {"npc_id": "b", "role": "사수", "rank": None},
        {"npc_id": "c", "role": "부장", "rank": None},
        {"npc_id": "d", "role": "고객", "rank": None},
        {"npc_id": "e", "role": "협력사", "rank": None},
    ]
    assigned = game_map.assign_spawn_slots(npcs, slots)
    assert len(set(assigned.values())) == 5  # 겹침 없음
    assert {assigned["d"], assigned["e"]} == {"npc4", "npc5"}  # 키워드 없는 둘이 확장 자리


def test_three_slot_map_unchanged_by_extension():
    # npc4·npc5가 표준에 추가돼도, 자리 3개짜리 기존 맵의 배정은 이전과 동일
    geo = {"spawns": [{"id": s} for s in ("player", "teamjang", "sasu", "bujang")]}
    assert game_map.npc_slots_in(geo) == ("teamjang", "sasu", "bujang")
    npcs = [{"npc_id": f"n{i}", "role": "", "rank": None} for i in range(4)]
    assigned = game_map.assign_spawn_slots(npcs, game_map.npc_slots_in(geo))
    assert set(assigned.values()) <= {"teamjang", "sasu", "bujang"}  # 확장 자리 미사용


def test_every_completed_map_assignment_resolves():
    resolved = [s for s in game_map.load_scenario_game_map() if game_map.map_info_for(s)]
    assert len(resolved) >= 30, f"좌표 완료 맵이 {len(resolved)}개뿐 — maps/ 마운트나 geometry 확인"


def test_geometry_response_is_isolated_from_cache():
    # 리뷰 #9: 응답에 실린 geometry를 변형해도 캐시가 오염되면 안 됨
    a = game_map.map_info_for("gm-01")
    a["geometry"]["spawns"].clear()
    b = game_map.map_info_for("gm-01")
    assert b["geometry"]["spawns"], "캐시 원본이 응답 변형에 오염됨"
