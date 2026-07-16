"""content/game_map — 시나리오→맵 정보 + NPC 자리(spawn slot) 배정."""

from app.content import game_map


def _clear_caches():
    game_map.load_scenario_game_map.cache_clear()
    game_map._load_geometry.cache_clear()


def test_mapping_loads_and_filters_null():
    _clear_caches()
    m = game_map.load_scenario_game_map()
    assert m, "scenario_map.yaml이 비어 있음"
    assert all(v for v in m.values()), "null 항목이 걸러지지 않음"
    assert "gm-01" in m  # 내용 검증된 대표 매핑


def test_map_info_for_mapped_scenario():
    _clear_caches()
    info = game_map.map_info_for("gm-01")  # 구매_자재_관리_사무실 — 좌표 완료 맵
    assert info is not None, "maps/ 볼륨이 컨테이너에 마운트됐는지 확인 (compose)"
    assert info["id"]
    assert info["background"].startswith("/maps/")
    geo = info["geometry"]
    assert geo["walkable"] and geo["collision"] and geo["spawns"]
    assert any(s["id"] == "player" for s in geo["spawns"])


def test_map_info_none_for_unmapped():
    _clear_caches()
    assert game_map.map_info_for("ms-06") is None  # 맵 미정(null) 시나리오
    assert game_map.map_info_for("없는-slug") is None


def test_spawn_slots_semantic_match():
    npcs = [
        {"npc_id": "a", "rank": "팀장", "role": "원무팀장"},
        {"npc_id": "b", "rank": None, "role": "사수·선임 멘토"},
        {"npc_id": "c", "rank": "부장", "role": "요구사항 결정"},
    ]
    slots = game_map.assign_spawn_slots(npcs)
    assert slots == {"a": "teamjang", "b": "sasu", "c": "bujang"}


def test_spawn_slots_fill_remaining_in_order():
    # 키워드 없는 NPC들은 남은 자리에 순서대로
    npcs = [
        {"npc_id": "a", "rank": None, "role": "고객"},
        {"npc_id": "b", "rank": "팀장", "role": ""},
        {"npc_id": "c", "rank": None, "role": "약사"},
    ]
    slots = game_map.assign_spawn_slots(npcs)
    assert slots["b"] == "teamjang"
    assert {slots["a"], slots["c"]} == {"sasu", "bujang"}


def test_spawn_slots_overflow_cycles():
    # 자리 3개보다 NPC가 많아도 전원 배정 (순환)
    npcs = [{"npc_id": f"n{i}", "rank": None, "role": ""} for i in range(5)]
    slots = game_map.assign_spawn_slots(npcs)
    assert len(slots) == 5
    assert all(s in game_map.NPC_SLOTS for s in slots.values())


def test_every_completed_map_assignment_resolves():
    # 매핑된 시나리오 중 geometry가 있는 것들은 전부 map_info가 나와야 함 (파일 무결성)
    _clear_caches()
    resolved = [s for s in game_map.load_scenario_game_map() if game_map.map_info_for(s)]
    assert len(resolved) >= 30, f"좌표 완료 맵이 {len(resolved)}개뿐 — maps/ 마운트나 geometry 확인"
