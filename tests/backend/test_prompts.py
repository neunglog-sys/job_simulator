"""llm/prompts — 템플릿 렌더링 (data/prompts 실제 파일 대상, 변수 누락 감지)."""

import pytest
from jinja2 import exceptions

from app.llm.prompts import render_prompt


def test_avatar_system_renders():
    out = render_prompt("avatar/system.md", summary=None, knowledge=None)
    assert "상담사" in out
    assert "{{" not in out  # 미치환 변수 없음


def test_avatar_summary_injected():
    out = render_prompt(
        "avatar/system.md", summary="사용자는 데이터 분석을 좋아함", knowledge=None
    )
    assert "사용자는 데이터 분석을 좋아함" in out


def test_avatar_knowledge_injected():
    out = render_prompt(
        "avatar/system.md",
        summary=None,
        knowledge="[backend-developer/daily-work.md]\n백엔드 개발자의 하루는...",
    )
    assert "백엔드 개발자의 하루는" in out
    # 지식 없을 땐 해당 섹션 자체가 없어야 함
    empty = render_prompt("avatar/system.md", summary=None, knowledge=None)
    assert "참고 직무 지식" not in empty


def test_missing_variable_raises():
    # StrictUndefined — 변수 빠뜨리면 조용히 넘어가지 않고 에러
    with pytest.raises(exceptions.UndefinedError):
        render_prompt("avatar/system.md")


def test_report_prompt_renders():
    out = render_prompt(
        "job-master/consult-report.md",
        recommendations=[{"job_title": "백엔드 개발자", "score": 80, "reason": "근거"}],
        competencies=[{"key": "communication", "name": "커뮤니케이션", "description": "설명"}],
    )
    assert "백엔드 개발자" in out
    assert "커뮤니케이션" in out
