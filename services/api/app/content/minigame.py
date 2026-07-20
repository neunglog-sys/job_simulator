"""4단계 미니게임 데이터 로더 — data/minigames/<slug>.yaml.

시나리오 본문과 분리된 별도 원본이다. `build_scenarios emit`이 이 폴더를 건드리지
않으므로, 게임을 붙이려고 시나리오의 `# AUTO-GENERATED` 마커를 지울 필요가 없다
(= 조사자료 재생성을 계속 받으면서 게임 데이터를 유지할 수 있다).

형식은 data/minigames/_SCHEMA.md 참조. 맵(game_map)과 같은 mtime 캐시 방식이라
파일을 고치면 재기동 없이 반영된다.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from app.core.config import settings
from app.domains.scoring.aggregate import MINIGAME_COMPETENCY

logger = logging.getLogger(__name__)

# slug → (mtime, 데이터). 실패는 저장하지 않아 파일을 고치면 즉시 반영된다.
_cache: dict[str, tuple[float, dict]] = {}


def clear_caches() -> None:
    """테스트용 — 모듈 캐시 초기화."""
    _cache.clear()


def minigame_for(slug: str) -> dict | None:
    """시나리오 slug → 미니게임 정의. 없거나 형식이 틀리면 None.

    None이면 프론트는 기존 '준비 중' 빈 창으로 폴백한다 — 게임 데이터가 아직 없는
    시나리오도 4단계를 통과할 수 있어야 하므로 여기서 예외를 던지지 않는다.
    """
    path = Path(settings.data_dir) / "minigames" / f"{slug}.yaml"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None  # 파일 없음 — 캐싱하지 않아 나중에 생기면 즉시 반영

    cached = _cache.get(slug)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        logger.warning("미니게임 YAML 파싱 실패 — 건너뜀: %s", path.name)
        return None

    game = _sanitize(doc, path.name)
    if game is None:
        return None
    _cache[slug] = (mtime, game)
    return game


def _sanitize(doc: object, filename: str) -> dict | None:
    """필수 키·엔진 키를 여기서 걸러낸다.

    엔진 키가 MINIGAME_COMPETENCY에 없으면 점수가 aggregate 단계에서 **조용히**
    버려진다(오류도 안 남). 그 침묵이 디버깅을 어렵게 하므로 로드 시점에 경고한다.
    """
    if not isinstance(doc, dict):
        logger.warning("미니게임 형식 오류(최상위가 매핑이 아님) — 건너뜀: %s", filename)
        return None

    engine = str(doc.get("engine") or "").strip()
    if engine not in MINIGAME_COMPETENCY:
        logger.warning(
            "미니게임 engine '%s'는 등록되지 않은 키 — 건너뜀: %s (사용 가능: %s)",
            engine, filename, ", ".join(sorted(MINIGAME_COMPETENCY)),
        )
        return None

    data = doc.get("data")
    if not isinstance(data, dict):
        logger.warning("미니게임 data 누락 — 건너뜀: %s", filename)
        return None

    return {
        "engine": engine,
        "title": doc.get("title") or "실무 미니게임",
        "intro": doc.get("intro") or "",
        "time_limit": _positive_number(doc.get("time_limit")),
        "pass_score": _positive_number(doc.get("pass_score")) or 70,
        "data": data,
        "scoring": doc.get("scoring") if isinstance(doc.get("scoring"), dict) else {},
    }


def _positive_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return float(value)
    return None
