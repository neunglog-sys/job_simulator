import argparse
import asyncio
import re
from pathlib import Path

from jinja2 import Template

from app.llm import get_llm
from app.llm.base import ChatMessage


def extract_persona(path: Path, npc_index: int) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    headings = list(
        re.finditer(r"^## NPC\s+\d+\s+—\s+(.+)$", text, re.MULTILINE)
    )

    if not 1 <= npc_index <= len(headings):
        raise ValueError(
            f"NPC 번호 오류: 1~{len(headings)} 중에서 선택해야 합니다."
        )

    index = npc_index - 1
    start = headings[index].start()
    end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
    block = text[start:end]

    subheadings = list(re.finditer(r"^### .+$", block, re.MULTILINE))
    if len(subheadings) < 2:
        raise ValueError("페르소나 프롬프트 또는 돌발 힌트 제목을 찾지 못했습니다.")

    persona = block[subheadings[0].end() : subheadings[1].start()].strip()
    role = headings[index].group(1).strip()
    return role, persona


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--npc", type=int, default=1)
    parser.add_argument("--message", required=True)
    parser.add_argument("--mission", default="NPC 프롬프트 테스트")
    parser.add_argument("--name", default="테스트 NPC")
    parser.add_argument("--rank", default="담당자")
    parser.add_argument("--trust", type=int, default=50)
    parser.add_argument("--schedule", type=int, default=50)
    parser.add_argument("--clarity", type=int, default=50)
    parser.add_argument("--knowledge", default="")
    args = parser.parse_args()

    role, persona = extract_persona(Path(args.file), args.npc)

    template = Template(
        Path("data/prompts/npc/system.md").read_text(encoding="utf-8")
    )
    system_prompt = template.render(
        persona_prompt=persona,
        mission=args.mission,
        name=args.name,
        rank=args.rank,
        state={
            "trust": args.trust,
            "schedule_stability": args.schedule,
            "requirement_clarity": args.clarity,
        },
        knowledge=args.knowledge,
    )

    llm = get_llm()
    print("provider:", llm.provider.name)
    print("role:", role)

    response = await llm.chat(
        [ChatMessage(role="user", content=args.message)],
        system=system_prompt,
        temperature=0.3,
    )

    print("response:", response)


if __name__ == "__main__":
    asyncio.run(main())