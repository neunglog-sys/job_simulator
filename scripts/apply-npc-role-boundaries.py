"""모든 family NPC 프롬프트에 지시 중심 역할 경계를 삽입한다."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PERSONA_DIR = ROOT / "data" / "prompts" / "npc" / "personas"
MARKER = "**NPC 역할 경계:**"
BOUNDARY = (
    "**NPC 역할 경계:** 대화는 직장 내 일상 대화와 현재 업무의 지시·요청·사실 확인에만 "
    "한정합니다. 상급자라면 해야 할 일·마감·보고 대상을 짧게 지시하고, 동료나 고객이라면 "
    "필요한 정보·요청·반응만 말합니다. 직급·성격·긴급도와 관계없이 자연스러운 직장 "
    "존댓말을 사용하고 이름·직급 뒤에 ‘님’을 붙여 부릅니다. ‘어이’, ‘야’, ‘신입’처럼 낮춰 부르는 "
    "호칭과 모욕·반말을 사용하지 않습니다. 사용자의 답을 채점하거나 오류 원인을 설명하거나 "
    "정답·개선 예시·단계별 힌트를 제공하지 않습니다. 결과가 기준에 맞지 않으면 구체적인 "
    "해설 대신 ‘자료를 다시 확인해서 보고해 주세요’처럼 재확인·재작업만 지시합니다. 위험 "
    "행동은 즉시 중단시키고 사용자가 직접 해결하거나 재시도하지 못하게 하며, 반드시 해당 업무의 "
    "유자격자 또는 현장 관리자에게 보고·이관하도록 지시합니다. 자세한 교정과 학습 피드백은 "
    "별도의 AI 코치 역할로 남깁니다."
)


def update_text(text: str) -> tuple[str, int]:
    pattern = re.compile(
        r"(^### 페르소나 프롬프트\s*$)(.*?)(?=^### 돌발 연출 힌트\s*$)",
        re.MULTILINE | re.DOTALL,
    )
    inserted = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal inserted
        heading, body = match.group(1), match.group(2).rstrip()
        if MARKER in body:
            updated_body = re.sub(
                rf"{re.escape(MARKER)}.*?(?=\n\n|\Z)",
                BOUNDARY,
                body,
                count=1,
                flags=re.DOTALL,
            )
            if updated_body != body:
                inserted += 1
            return f"{heading}{updated_body}\n\n"
        inserted += 1
        return f"{heading}{body}\n\n{BOUNDARY}\n\n"

    updated = pattern.sub(replace, text)
    return updated.rstrip() + "\n", inserted


def main() -> None:
    total = 0
    changed = []
    for path in sorted(PERSONA_DIR.glob("F*.md")):
        before = path.read_text(encoding="utf-8")
        after, inserted = update_text(before)
        if inserted:
            path.write_text(after, encoding="utf-8", newline="\n")
            total += inserted
            changed.append((path.name, inserted))
    print(f"inserted={total} files={len(changed)}")
    for name, count in changed:
        print(f"{name}: {count}")


if __name__ == "__main__":
    main()
