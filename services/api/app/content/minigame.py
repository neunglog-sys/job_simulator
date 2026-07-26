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

UNSCORED_ENGINES = {"research", "design"}

# slug → (mtime, 게임 목록). 실패는 저장하지 않아 파일을 고치면 즉시 반영된다.
_cache: dict[str, tuple[float, list[dict]]] = {}


def clear_caches() -> None:
    """테스트용 — 모듈 캐시 초기화."""
    _cache.clear()


def minigames_for(slug: str) -> list[dict]:
    """시나리오 slug → 미니게임 **목록**. 없거나 형식이 틀리면 빈 리스트.

    파일 형식 두 가지를 모두 받는다(하위호환):
    - **단일 게임**: 최상위에 `engine`/`data` — 기존 44개 파일. 1개짜리 목록으로 감싼다.
    - **다중 게임**: 최상위 `games:` 리스트 — 한 직무에 게임을 2~3개 붙일 때.

    빈 리스트면 프론트는 기존 '준비 중' 빈 창으로 폴백한다 — 게임 데이터가 아직 없는
    시나리오도 4단계를 통과할 수 있어야 하므로 여기서 예외를 던지지 않는다.
    """
    path = Path(settings.data_dir) / "minigames" / f"{slug}.yaml"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return []  # 파일 없음 — 캐싱하지 않아 나중에 생기면 즉시 반영

    cached = _cache.get(slug)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        logger.warning("미니게임 YAML 파싱 실패 — 건너뜀: %s", path.name)
        return []

    games = _sanitize_all(doc, path.name, slug)
    _cache[slug] = (mtime, games)
    return games


def minigame_for(slug: str) -> dict | None:
    """첫 번째 미니게임 — 게임 1개만 쓰던 기존 호출부 하위호환용."""
    games = minigames_for(slug)
    return games[0] if games else None


def declared_for_engine(slug: str, engine: str | None) -> dict | None:
    """제출된 engine에 해당하는 게임 선언. 없으면 None(= 대조 대상 없음).

    결과 검증은 '선언된 게임 중 그 엔진이 있는지'를 봐야 한다. 첫 게임하고만 비교하면
    2번째 게임 결과가 통째로 engine_mismatch로 버려진다.
    선언이 하나도 없는 시나리오는 그대로 None — 게임 데이터가 아직 없어도 4단계는 통과한다.
    """
    games = minigames_for(slug)
    if not games:
        return None
    name = str(engine or "").strip()
    # 엔진이 안 맞으면 첫 게임을 돌려줘 기존처럼 engine_mismatch로 기록되게 한다.
    return next((g for g in games if g.get("engine") == name), games[0])


def _sanitize_all(doc: object, filename: str, slug: str) -> list[dict]:
    """파일 한 개 → 게임 목록. `games:` 리스트면 다중, 아니면 단일 게임으로 취급."""
    if not isinstance(doc, dict):
        logger.warning("미니게임 형식 오류(최상위가 매핑이 아님) — 건너뜀: %s", filename)
        return []

    scenario_id = str(doc.get("scenario_id") or slug)
    raw_games = doc.get("games")
    if isinstance(raw_games, list):
        games = []
        for index, raw in enumerate(raw_games):
            if not isinstance(raw, dict):
                logger.warning("미니게임 games[%d] 형식 오류 — 건너뜀: %s", index, filename)
                continue
            game = _sanitize(raw, filename, default_id=f"{scenario_id}-{index + 1}")
            if game is not None:
                games.append(game)
        return games

    game = _sanitize(doc, filename, default_id=scenario_id)
    return [game] if game is not None else []


def _sanitize(doc: dict, filename: str, default_id: str | None = None) -> dict | None:
    """필수 키·엔진 키를 여기서 걸러낸다.

    엔진 키가 MINIGAME_COMPETENCY에 없으면 점수가 aggregate 단계에서 **조용히**
    버려진다(오류도 안 남). 그 침묵이 디버깅을 어렵게 하므로 로드 시점에 경고한다.
    """
    engine = str(doc.get("engine") or "").strip()
    supported_engines = set(MINIGAME_COMPETENCY) | UNSCORED_ENGINES
    if engine not in supported_engines:
        logger.warning(
            "미니게임 engine '%s'는 등록되지 않은 키 — 건너뜀: %s (사용 가능: %s)",
            engine, filename, ", ".join(sorted(supported_engines)),
        )
        return None

    data = doc.get("data")
    if not isinstance(data, dict):
        logger.warning("미니게임 data 누락 — 건너뜀: %s", filename)
        return None

    # 다중 게임이면 호출부가 default_id(= scenario_id-순번)를 준다. 단독 호출 시에는
    # 기존처럼 scenario_id(없으면 파일명)로 떨어진다.
    fallback_id = default_id or str(doc.get("scenario_id") or Path(filename).stem)
    return {
        "id": str(doc.get("id") or fallback_id),
        # 어느 시나리오 스텝에서 띄울지 — 다중 게임일 때 프론트가 순서를 잡는 근거.
        # 없으면 null (프론트가 목록 순서대로 진행).
        "step": str(doc["step"]) if doc.get("step") else None,
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
