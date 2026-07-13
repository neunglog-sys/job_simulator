"""NPC persona Markdown의 돌발 연출 힌트 표기를 단일 형식으로 정규화한다."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PERSONA_DIR = ROOT / "data" / "prompts" / "npc" / "personas"


def normalize_inline_hint(match: re.Match[str]) -> str:
    body = match.group(1).strip()
    body = re.sub(r"^①\s*", "", body)
    parts = re.split(r"\s*②\s*", body, maxsplit=1)
    bullets = "\n".join(f"- {part.strip()}" for part in parts if part.strip())
    return f"### 돌발 연출 힌트\n\n{bullets}"


def normalize(text: str) -> str:
    text = re.sub(
        r"(?m)^### 돌발 연출 힌트(?:\s*\([^\n]*\))?\s*$",
        "### 돌발 연출 힌트",
        text,
    )
    text = re.sub(
        r"(?m)^\*\*돌발 연출 힌트\*\*\s*$",
        "### 돌발 연출 힌트",
        text,
    )
    text = re.sub(
        r"(?m)^돌발 연출 힌트:\s*$",
        "### 돌발 연출 힌트",
        text,
    )
    text = re.sub(
        r"(?m)^- 돌발 연출 힌트:\s*(.+)$",
        normalize_inline_hint,
        text,
    )
    return text.rstrip() + "\n"


def main() -> None:
    changed = []
    for path in sorted(PERSONA_DIR.glob("F*.md")):
        before = path.read_text(encoding="utf-8")
        after = normalize(before)
        if after != before:
            path.write_text(after, encoding="utf-8", newline="\n")
            changed.append(path.name)
    print(f"normalized={len(changed)}")
    for name in changed:
        print(name)


if __name__ == "__main__":
    main()
