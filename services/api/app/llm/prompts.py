"""data/prompts/ 템플릿 렌더러 — 프롬프트는 코드에 하드코딩하지 않는다."""

from functools import lru_cache
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from app.core.config import settings


@lru_cache
def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(Path(settings.data_dir) / "prompts"),
        undefined=StrictUndefined,  # 변수 누락은 조용히 넘기지 않고 에러
        auto_reload=True,           # 개발 중 템플릿 수정 즉시 반영
    )


def render_prompt(_template: str, **variables) -> str:
    """예: render_prompt("avatar/system.md", summary=None)

    첫 인자는 언더스코어 이름 — 템플릿 변수(name 등)와 충돌 방지.
    """
    return _env().get_template(_template).render(**variables)
