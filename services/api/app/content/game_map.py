"""게임 맵 연결 — 시나리오가 쓸 맵(배경·geometry)과 NPC 자리(spawn slot) 배정.

데이터 흐름:
  data/maps/scenario_map.yaml  : slug → maps/ 폴더명 (미션 내용으로 검증된 매핑)
  maps/<폴더>/geometry.json    : Tiled로 제작한 좌표 (walkable·collision·spawns)
  maps/<폴더>/<배경>.png       : main.py가 /maps 정적 마운트로 서빙

맵이 없거나(매핑 null) maps/가 마운트 안 된 환경(예: 배포 초기)에서는 None을 반환해
게임이 기존 방식(모듈 배경)으로 동작한다 — 하위호환.
"""

import json
import logging
from functools import lru_cache
from pathlib import Path

import yaml

from app.core.config import settings

logger = logging.getLogger(__name__)

MAPS_DIR = Path("maps")  # 컨테이너에선 /app/maps (compose 볼륨), 로컬 실행 시 repo의 maps/

# 맵의 NPC 자리는 3종 고정 (전 맵 공통 spawn 이름)
NPC_SLOTS = ("teamjang", "sasu", "bujang")

# rank/role 키워드 → 자리. 위에서부터 먼저 맞는 것 (부장이 팀장보다 먼저 — '팀장'이 더 흔한 어휘라 뒤로)
_SLOT_KEYWORDS = (
    ("bujang", ("부장",)),
    ("teamjang", ("팀장", "센터장", "점장", "지점장", "소장", "실장", "반장", "매니저", "차장")),
    ("sasu", ("사수", "선임", "멘토", "수석", "과장", "주임", "트레이너")),
)


@lru_cache
def load_scenario_game_map() -> dict[str, str]:
    """slug → maps/ 폴더명. null(맵 미배정)은 걸러낸다. 파일 없으면 빈 dict."""
    path = Path(settings.data_dir) / "maps" / "scenario_map.yaml"
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {k: v for k, v in raw.items() if v}


@lru_cache(maxsize=64)
def _load_geometry(folder: str) -> dict | None:
    path = MAPS_DIR / folder / "geometry.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        logger.warning("geometry.json 파싱 실패: %s", path)
        return None


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
        "background": f"/maps/{folder}/{background}" if background else None,
        "geometry": geometry,
    }


def assign_spawn_slots(npcs: list[dict]) -> dict[str, str]:
    """npc_id → 자리(teamjang|sasu|bujang) 배정.

    ① rank/role 키워드로 의미 매칭 (팀장 계열 → teamjang …)
    ② 못 정한 NPC는 남은 자리에 순서대로
    ③ 자리가 모자라면 순환 재사용 — 스텝마다 등장 NPC가 1~2명이라 화면에서 겹칠 일은 드물다
    """
    assignment: dict[str, str] = {}
    used: set[str] = set()

    for npc in npcs:  # 1차: 의미 매칭 (자리당 첫 매칭 우선)
        blob = f"{npc.get('rank') or ''} {npc.get('role') or ''}"
        for slot, keywords in _SLOT_KEYWORDS:
            if slot not in used and any(k in blob for k in keywords):
                assignment[npc["npc_id"]] = slot
                used.add(slot)
                break

    free = [s for s in NPC_SLOTS if s not in used]
    overflow = 0
    for npc in npcs:  # 2차: 나머지 채우기
        if npc["npc_id"] in assignment:
            continue
        if free:
            assignment[npc["npc_id"]] = free.pop(0)
        else:  # 3차: 순환
            assignment[npc["npc_id"]] = NPC_SLOTS[overflow % len(NPC_SLOTS)]
            overflow += 1
    return assignment
