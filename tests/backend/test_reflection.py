"""5단계 체험 소감문 — 채점하지 않고 최종 리포트의 재료로만 쓴다.

리포트 = 상담 + 수행 + 소감. 미션(업무 산출물)은 채점 대상이지만 소감은 체험자 본인의
목소리라 점수로 환산하지 않는다.
"""

import pytest

from app.llm.prompts import render_prompt

_BASE = dict(
    recommendations=[{"job_title": "백엔드 개발자", "score": 80, "reason": "근거"}],
    competencies=[{"key": "communication", "name": "커뮤니케이션", "description": "설명"}],
)
_PERF = {
    "scenario_title": "웹·앱 개발 — 신입의 하루",
    "total": 82,
    "mission_avg": 85,
    "competencies": {"communication": 81},
    "missions": [{"type": "정상업무", "adjusted": 85, "attempts": 1}],
    "quest": None,
}


def test_report_prompt_includes_reflection():
    out = render_prompt(
        "job-master/consult-report.md",
        **_BASE,
        performance={**_PERF, "reflection": "코드 리뷰가 생각보다 재미있었지만 회의는 지루했어요."},
    )
    assert "체험 후 본인이 쓴 소감" in out
    assert "코드 리뷰가 생각보다 재미있었지만" in out
    assert "채점 대상이 아니라" in out  # 점수로 환산하지 말라는 지침이 함께 가야 한다


def test_report_prompt_without_reflection():
    # 소감을 안 썼어도 리포트는 정상 생성돼야 한다 (소감은 선택)
    out = render_prompt("job-master/consult-report.md", **_BASE, performance=_PERF)
    assert "체험 후 본인이 쓴 소감" not in out
    assert "시나리오 총점: 82점" in out


@pytest.mark.parametrize("value", ["", "   ", None])
def test_empty_reflection_rejected(value):
    from fastapi import HTTPException

    from app.domains.simulation.service import save_reflection

    class _Sim:
        state: dict = {}

    with pytest.raises(HTTPException) as err:
        import asyncio

        asyncio.run(save_reflection(None, _Sim(), value))
    assert err.value.status_code == 400
