"""추천근거 개인화 골든셋 — 실제 LLM 출력에서도 **날조 인용이 새지 않는지** 재현 가능 검증.

단위테스트(test_evidence.py)는 그라운딩 게이트를 순수 함수로 검증하지만, 프롬프트나 모델을
바꿨을 때 실제 LLM이 규칙을 지키는지는 실호출로만 확인된다 — 이 스크립트가 그 갭을 메운다.

핵심 불변식(케이스마다 하드 체크):
  - 반환된 **모든 quote가 사용자 발화의 부분문자열**이다(그라운딩 게이트가 실호출에서도 유지).
    상담사 발화를 인용하거나 의역/날조한 근거는 이 검사를 통과할 수 없다.
  - dimension_code가 전부 43축에 실재한다.
  - 근거가 풍부한 케이스는 최소 1건 이상 추출된다(기능이 실제로 동작하는지, 빈 리스트로 거짓 통과 방지).

사람이 눈으로 확인할 것: 추출된 quote가 해당 축(value)의 근거로 타당한지 — 출력을 스팟체크.

사용: docker compose exec api python -m app.scripts.eval_evidence
"""

import asyncio
import logging
import sys

from app.domains.recommendation.evidence import (
    _ground_quote,
    _valid_dimension_codes,
    extract_from_transcript,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _transcript(user_lines: list[str], counselor_lines: list[str]) -> tuple[str, str]:
    """사용자·상담사 발화를 번갈아 엮어 (transcript, user_text) 반환."""
    lines = []
    for i, u in enumerate(user_lines):
        if i < len(counselor_lines):
            lines.append(f"상담사: {counselor_lines[i]}")
        lines.append(f"사용자: {u}")
    transcript = "\n".join(lines)
    user_text = "\n".join(user_lines)
    return transcript, user_text


# 인용 가능한 구체 발화가 담긴 케이스(rich=True) + 통제 케이스(막연, rich=False).
CASES = [
    {
        "name": "detail_accounting", "rich": True,
        "user": [
            "저는 숫자 오류를 잘 찾아내는 편이에요.",
            "팀원이 놓친 계산 실수를 제가 먼저 발견한 적도 있어요.",
            "정해진 양식대로 꼼꼼하게 정리하는 게 마음 편해요.",
        ],
        "counselor": ["어떤 일을 할 때 편하세요?", "구체적인 경험이 있을까요?", "정리하는 일은 어떠세요?"],
    },
    {
        "name": "creative_marketing", "rich": True,
        "user": [
            "영상 편집을 밤새 해도 재밌었어요.",
            "카피 한 줄을 열 번쯤 고쳐 쓰면서 표현을 다듬는 게 좋아요.",
        ],
        "counselor": ["어떤 활동이 즐거우셨어요?", "왜 그게 좋으셨나요?"],
    },
    {
        "name": "social_helping", "rich": True,
        "user": [
            "누가 저 덕분에 문제를 해결했다고 할 때 뿌듯해요.",
            "낯선 사람한테 설명해서 잘 전달됐던 경험이 있어요.",
        ],
        "counselor": ["언제 보람을 느끼세요?", "소통은 어떠세요?"],
    },
    {
        # 통제: 사용자는 막연·회피만. 상담사만 구체적 사실을 언급 → 그 어떤 것도 grounded 될 수 없어야.
        "name": "vague_control", "rich": False,
        "user": ["글쎄요, 잘 모르겠어요.", "딱히 없는 것 같아요.", "네 그렇네요."],
        "counselor": [
            "회계 자격증이 있으시다고 하셨죠?",  # 상담사 발화 — 절대 인용되면 안 됨
            "데이터 분석을 잘하시나요?",
            "리더 경험이 있으세요?",
        ],
    },
]


def _grade(case: dict, items: list) -> list[str]:
    """실패한 하드 체크 이름 리스트(빈 리스트면 통과)."""
    user_text = "\n".join(case["user"])
    valid = _valid_dimension_codes()
    fails = []
    for it in items:
        if not _ground_quote(it.quote, user_text):
            fails.append(f"UNGROUNDED_QUOTE({it.quote[:30]!r})")
        if it.dimension_code not in valid:
            fails.append(f"INVALID_DIM({it.dimension_code})")
    if case["rich"] and not items:
        fails.append("NO_EVIDENCE_FROM_RICH_CASE")
    return fails


async def main() -> int:
    results = []
    for case in CASES:
        transcript, user_text = _transcript(case["user"], case["counselor"])
        items = await extract_from_transcript(transcript, user_text)
        fails = _grade(case, items)
        results.append((case, items, fails))
        print(f"[{case['name']}] {'PASS' if not fails else f'FAIL {fails}'} — 근거 {len(items)}건")
        for it in items:
            print(f"    {it.dimension_code} (conf {it.confidence}) · {it.value}")
            print(f"      quote: {it.quote!r}")
        print()

    passed = sum(1 for _, _, f in results if not f)
    print("=" * 60)
    print(f"결과: {passed}/{len(results)} 케이스 통과")
    if passed != len(results):
        print("\n실패 상세:")
        for case, _, fails in results:
            if fails:
                print(f"  - {case['name']}: {fails}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
