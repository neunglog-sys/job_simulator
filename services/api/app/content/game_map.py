"""게임 맵 연결 — 시나리오가 쓸 맵(배경·geometry)과 NPC 자리(spawn slot) 배정.

데이터 흐름:
  data/maps/scenario_map.yaml  : slug → maps/ 폴더명 (미션 내용으로 검증된 매핑)
  maps/<폴더>/geometry.json    : Tiled로 제작한 좌표 (walkable·collision·spawns)
  maps/<폴더>/<배경>.png       : main.py가 /maps 정적 마운트로 서빙

캐시는 mtime 기반 — 파일이 바뀌면 자동 재로드되고, **실패(파일 없음·파싱 오류)는
캐싱하지 않는다**: 배포 후 maps/를 늦게 업로드하거나 좌표를 수정해도 재시작 없이 반영된다.

맵이 없거나(매핑 null) maps/가 없는 환경에서는 None을 반환해 게임이 기존 방식
(모듈 배경)으로 동작한다 — 하위호환.
"""

import copy
import json
import logging
from itertools import chain, cycle
from pathlib import Path
from urllib.parse import quote

from app.content.loader import read_yaml_map
from app.core.config import settings

logger = logging.getLogger(__name__)

# NPC 자리 표준 id — 백엔드·프론트 계약은 항상 이 영문 id로 통일한다.
# 기본 3종 + 확장 2종(npc4·npc5): 미션 등장 NPC가 4~5명인 시나리오용 (맵 리메이크 규격 v2).
# 순서 = 배정 우선순위. 맵에 실제로 찍힌 자리만 쓰이므로(npc_slots_in) 자리 3개짜리
# 기존 맵은 동작이 변하지 않는다.
NPC_SLOTS = ("teamjang", "sasu", "bujang", "npc4", "npc5")

# 일부 맵(tmx)은 spawn 이름을 한글로 찍었다 — 로드 시점에 표준 id로 정규화
_SPAWN_ALIASES = {"팀장": "teamjang", "사수": "sasu", "부장": "bujang", "플레이어": "player"}

# 키워드 → 자리. role(기능)을 rank(직급 표기)보다 먼저 보므로,
# role='사수', rank='구매팀장'인 NPC는 사수 자리에 선다 (직급 문구에 휘둘리지 않음)
_SLOT_KEYWORDS = (
    ("bujang", ("부장",)),
    ("teamjang", ("팀장", "센터장", "점장", "지점장", "소장", "실장", "반장", "매니저", "차장")),
    ("sasu", ("사수", "선임", "멘토", "수석", "과장", "주임", "트레이너")),
)

# ── mtime 캐시 (실패는 저장하지 않음) ──
_geometry_cache: dict[str, tuple[float, dict]] = {}
_mapping_cache: tuple[float, dict[str, str]] | None = None


def clear_caches() -> None:
    """테스트용 — 모듈 캐시 초기화."""
    global _mapping_cache
    _geometry_cache.clear()
    _mapping_cache = None


def load_scenario_game_map() -> dict[str, str]:
    """slug → maps/ 폴더명. null(맵 미배정)은 걸러진다. 파일 없거나 깨지면 빈 dict."""
    global _mapping_cache
    path = Path(settings.data_dir) / "maps" / "scenario_map.yaml"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}  # 파일 없음 — 캐싱하지 않아 나중에 생기면 즉시 반영
    if _mapping_cache and _mapping_cache[0] == mtime:
        return _mapping_cache[1]
    mapping = read_yaml_map(path)
    _mapping_cache = (mtime, mapping)
    return mapping


def _load_geometry(folder: str) -> dict | None:
    path = Path(settings.maps_dir) / folder / "geometry.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        _geometry_cache.pop(folder, None)
        return None
    cached = _geometry_cache.get(folder)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        geometry = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        logger.warning("geometry.json 파싱 실패: %s", path)
        return None  # 실패는 캐싱하지 않음 — 파일 고치면 즉시 복구
    if not isinstance(geometry, dict):
        logger.warning("geometry.json이 객체가 아님: %s", path)
        return None
    for spawn in geometry.get("spawns", []):  # 한글 spawn id → 표준 id 정규화
        spawn["id"] = _SPAWN_ALIASES.get(spawn.get("id"), spawn.get("id"))
    _geometry_cache[folder] = (mtime, geometry)
    return geometry


def map_info_for(slug: str) -> dict | None:
    """시나리오의 맵 정보 {id, background, geometry} — 없으면 None (프론트는 기존 배경 사용)."""
    folder = load_scenario_game_map().get(slug)
    if not folder:
        return None
    geometry = _load_geometry(folder)
    if geometry is None:
        return None  # 매핑은 있는데 좌표 파일이 없음(마운트 안 됨 등) — 조용히 기존 방식
    background = geometry.get("background")
    return {
        "id": folder,
        # 폴더·파일명에 공백/한글이 흔하므로 세그먼트 퍼센트 인코딩 (엄격한 클라이언트 대비)
        "background": f"/maps/{quote(folder)}/{quote(background)}" if background else None,
        # 캐시 원본을 응답에 직접 노출하지 않음 — 응답 쪽 변형이 캐시를 오염시키지 않게
        "geometry": copy.deepcopy(geometry),
    }


def available_map_id(slug: str) -> str | None:
    """geometry까지 실제 로드 가능한 경우에만 맵 id.

    /api/scenarios의 map_id와 시뮬레이션 응답의 map이 같은 신호를 내게 한다 —
    목록엔 맵이 있다고 하고 게임 시작하니 null인 어긋남 방지.
    """
    folder = load_scenario_game_map().get(slug)
    if not folder or _load_geometry(folder) is None:
        return None
    return folder


def npc_slots_in(geometry: dict) -> tuple[str, ...]:
    """이 맵에 실제로 존재하는 NPC 자리 (표준 순서). 자리 정보가 없으면 표준 3종 가정."""
    present = {s.get("id") for s in geometry.get("spawns", [])}
    slots = tuple(s for s in NPC_SLOTS if s in present)
    return slots or NPC_SLOTS


def assign_spawn_slots(
    npcs: list[dict], slots: tuple[str, ...] = NPC_SLOTS
) -> dict[str, str]:
    """npc_id → 자리 배정. slots = 이 맵에 실제로 있는 자리만.

    ① 데이터 우선 — NPC 배치의 appearance.location이 유효한 자리면 그대로 (코드 추론 불필요)
    ② role 키워드 → ③ rank 키워드 (기능이 직급 표기보다 우선)
    ④ 남는 NPC는 빈 자리 순서대로, 초과분은 순환 — 스텝당 등장 NPC가 1~2명이라 안전
    """
    assignment: dict[str, str] = {}
    used: set[str] = set()

    for npc in npcs:  # ① appearance.location (데이터가 정답)
        loc = npc.get("location")
        loc = _SPAWN_ALIASES.get(loc, loc)
        if loc in slots and loc not in used:
            assignment[npc["npc_id"]] = loc
            used.add(loc)

    for field in ("role", "rank"):  # ②③ role 먼저, 그다음 rank
        for npc in npcs:
            if npc["npc_id"] in assignment:
                continue
            text = str(npc.get(field) or "")
            for slot, keywords in _SLOT_KEYWORDS:
                if slot in slots and slot not in used and any(k in text for k in keywords):
                    assignment[npc["npc_id"]] = slot
                    used.add(slot)
                    break

    leftover = chain([s for s in slots if s not in used], cycle(slots))  # ④ 채우기+순환
    for npc in npcs:
        if npc["npc_id"] not in assignment:
            assignment[npc["npc_id"]] = next(leftover)
    return assignment
