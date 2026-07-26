"""스텝 제공자료 로더 — data/materials/<slug>.yaml.

시나리오 본문(data/scenarios)과 분리된 별도 원본이다. `build_scenarios emit`이 이 폴더를
건드리지 않으므로, 조사자료 재생성을 계속 받으면서 자료 본문을 유지할 수 있다(미니게임과 동일).

시나리오의 `guide`는 "제공 자료: POS 정산 내역, 영수증 묶음, …"처럼 **이름만** 나열한다.
여기엔 그 자료의 **본문**(수치·전표·체크리스트)을 담아, 플레이어가 실제로 대조해 답을 찾게 한다.

한 스텝에 세트를 여러 개 두고 시뮬레이션마다 하나만 보여준다 — 세트별로 차액 원인이 달라
정답을 외워서 풀 수 없다. 어떤 세트를 쓸지는 시뮬레이션 생성 시 state에 박아 고정한다.

형식:
    scenario_id: kts-03
    steps:
      m4:
        sets:
        - id: card-void
          cause: 차액 원인 한 줄(채점 기준에 쓰인다 — 클라이언트로 내보내지 않는다)
          documents:
          - title: POS 정산 내역
            body: |
              ...

맵(game_map)과 같은 mtime 캐시라 파일을 고치면 재기동 없이 반영된다.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from app.core.config import settings

logger = logging.getLogger(__name__)

# slug → (mtime, {step_id: [세트, ...]}). 실패는 저장하지 않아 파일을 고치면 즉시 반영된다.
_cache: dict[str, tuple[float, dict[str, list[dict]]]] = {}


def clear_caches() -> None:
    """테스트용 — 모듈 캐시 초기화."""
    _cache.clear()


def _path(slug: str) -> Path:
    return Path(settings.data_dir) / "materials" / f"{slug}.yaml"


def _load(slug: str) -> dict[str, list[dict]]:
    """data/materials/<slug>.yaml → {step_id: [세트, ...]}. 없거나 형식이 틀리면 빈 dict."""
    path = _path(slug)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    cached = _cache.get(slug)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        logger.exception("제공자료 로드 실패 — 자료 없이 진행 (%s)", path)
        return {}

    out: dict[str, list[dict]] = {}
    for step_id, entry in (doc.get("steps") or {}).items():
        sets = (entry or {}).get("sets") or []
        valid = [
            s
            for s in sets
            if isinstance(s, dict) and isinstance(s.get("documents"), list) and s["documents"]
        ]
        if len(valid) != len(sets):
            logger.warning("제공자료 세트 형식 오류 — 건너뜀 (%s, step=%s)", path, step_id)
        if valid:
            out[str(step_id)] = valid

    _cache[slug] = (mtime, out)
    return out


def material_sets_for(slug: str, step_id: str) -> list[dict]:
    """그 스텝에 준비된 제공자료 세트 목록. 없으면 빈 리스트."""
    return _load(slug).get(step_id, [])


def steps_with_materials(slug: str) -> list[str]:
    """제공자료가 준비된 스텝 id 목록 — 시뮬레이션 생성 시 세트를 뽑아 둘 대상."""
    return sorted(_load(slug).keys())


def public_documents(material_set: dict) -> list[dict]:
    """클라이언트에 보낼 자료 본문 — 정답(cause)은 빼고 문서만."""
    return [
        {"title": str(doc.get("title") or ""), "body": str(doc.get("body") or "")}
        for doc in material_set.get("documents") or []
    ]
