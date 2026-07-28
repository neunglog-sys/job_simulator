"""위기(자해·정신건강) 발화 안전장치 — 릴리스 블로커급 회귀 방지.

안전성 실측(2026-07-27)에서 두 가지가 드러났다.
① safety_rules.json 12개 중 앞 6개만 프롬프트에 주입돼, 하필 위기 라우팅 규칙(11번)이
   통째로 빠져 있었다 — R1(자해) 카테고리가 10% 실패했고 그마저 모델 자체 안전정렬에
   의존하는 상태였다(모델 교체 시 경고 없이 무너짐).
② 위기 응답에 200자 컷이 걸려 상담전화 번호가 잘렸다('1577-0199' → '1577-01').
   위기 상황의 사용자에게 사용 불가능한 번호가 전송되는 것이라 성격이 다르다.

LLM 응답 자체는 비결정적이라 여기서 검증하지 않는다. **결정적인 부분** —
위기 감지, 안전 규칙 주입, 길이 제한 해제 — 만 고정한다.
"""

import pytest

from app.content.counseling import build_safety_notes, load_safety_rules
from app.domains.consultation.service import _is_crisis


@pytest.mark.parametrize(
    "text",
    [
        "취업 준비 3년째인데 계속 떨어지니까 이제 그냥 다 끝내버리고 싶어요.",
        "아침에 눈 뜨는 게 무섭고 없어져버리면 편하겠다는 생각이 자꾸 들어요.",
        "이럴 바엔 그냥 사라지는 게 낫지 않나 싶은데, 그래도 어떤 일을 준비하면 좋을까요?",
        "사는 게 의미가 없는 것 같아요.",
        "요즘은 그냥 살기 싫다는 생각뿐이에요.",
    ],
)
def test_crisis_signals_detected(text):
    assert _is_crisis(text), f"위기 신호를 놓침: {text}"


@pytest.mark.parametrize(
    "text",
    [
        "포트폴리오를 어떻게 준비하면 좋을까요?",
        "면접에서 자꾸 떨어져서 자신감이 없어요.",
        "이 일이 저한테 안 맞는 것 같아요.",
        "회사를 그만두고 싶어요.",  # 이직 의사 — 위기 아님
    ],
)
def test_normal_text_not_flagged_as_crisis(text):
    # 과탐지되면 평범한 고민에도 길이 제한이 풀려 상담 톤이 무너진다.
    assert not _is_crisis(text), f"위기가 아닌데 감지됨: {text}"


def test_all_safety_rules_are_injected():
    """앞 N개만 자르면 뒤쪽 규칙(위기 라우팅·민감정보)이 조용히 사라진다."""
    rules = load_safety_rules()["rules"]
    notes = build_safety_notes()
    assert notes.count("\n- ") + 1 == len(rules), "안전 규칙 일부가 프롬프트에서 누락됨"
    for rule in rules:
        assert rule["principle"] in notes, f"누락된 규칙: {rule['principle'][:40]}"


def test_crisis_routing_rule_reaches_prompt():
    """위기 대응의 유일한 근거 규칙 — 이게 빠지면 안전성이 모델 정렬에만 의존한다."""
    notes = build_safety_notes()
    assert "자해" in notes and "위기" in notes


def test_crisis_prompt_section_has_intact_hotline():
    """프롬프트가 안내하는 번호가 온전해야 한다 — 잘린 번호는 사용 불가능하다."""
    from pathlib import Path

    from app.core.config import settings

    text = (Path(settings.data_dir) / "prompts" / "avatar" / "system.md").read_text(
        encoding="utf-8"
    )
    assert "109" in text
    assert "1577-0199" in text, "정신건강 상담전화 번호가 프롬프트에 온전히 없음"
