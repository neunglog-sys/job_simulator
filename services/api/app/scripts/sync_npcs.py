"""NPC 동기화 CLI — YAML(원본) → DB(복사본).

  python -m app.scripts.sync_npcs --check   # DB 변경 없이 신규/수정/삭제 미리보기
  python -m app.scripts.sync_npcs --apply   # 실제 반영

공용 DB라 부팅 자동 seed가 서로 덮어쓸 수 있으므로, 콘텐츠 반영은 담당자가 --apply로.
NPC 설정은 DB에서 직접 고치지 말고 data/npcs/*.yaml에서만 수정한다.
"""

import asyncio
import sys

from app.content.loader import load_npcs
from app.content.npc_sync import sync_npcs


async def main(apply: bool) -> None:
    from app.core.db import SessionFactory

    npcs_by_slug = load_npcs()
    total = sum(len(v) for v in npcs_by_slug.values())
    async with SessionFactory() as session:
        report = await sync_npcs(session, npcs_by_slug, apply=apply)

    mode = "반영 완료" if apply else "미리보기 (DB 변경 없음)"
    print(f"NPC 동기화 {mode}")
    print(f"  총 {total}명 | 신규 {report['new']} · 수정 {report['changed']} · "
          f"변경없음 {report['unchanged']} · 비활성 {report['deactivated']}")
    if not apply:
        print("  실제 반영: python -m app.scripts.sync_npcs --apply")


if __name__ == "__main__":
    flags = set(sys.argv[1:])
    if "--apply" not in flags and "--check" not in flags:
        print("사용법: python -m app.scripts.sync_npcs [--check | --apply]")
        raise SystemExit(2)
    asyncio.run(main(apply="--apply" in flags))
