"""레거시(J 기준) 추천 삭제 — F 개편 배포 후 1회 실행 (팀장 확정 2026-07-27).

저장된 추천은 생성 시점 스냅샷이라 코드가 F로 바뀌어도 과거 상담엔 J 추천이
계속 보인다. 삭제하면 사용자가 다음에 추천 버튼을 누를 때 기존 멱등 흐름이
새 F 기준으로 자동 재생성한다(별도 백필 불필요). recommendation_id를 참조하는
FK가 없음은 검증 완료 — 행만 지우면 된다.

⚠️ 반드시 새 코드가 배포·확인된 뒤에 실행할 것. 그 전에 지우면 구 코드가
   J 기준으로 재생성해 삭제가 무의미해진다.
⚠️ 대화가 짧았던 상담은 재생성 시 적성 게이트(409)에 걸려 "더 대화하세요"가
   뜰 수 있다 — 팀장 수용 완료(F로 새로 받게 하는 것이 목적).

사용 (VM에서):
    docker compose -f infra/docker-compose.yml exec api \
        python -m app.scripts.purge_legacy_recommendations            # dry-run(백업만)
    docker compose -f infra/docker-compose.yml exec api \
        python -m app.scripts.purge_legacy_recommendations --yes      # 백업 + 삭제
"""

import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from app.core.db import SessionFactory
from app.models import Recommendation

F_CODE = re.compile(r"f\d{2}")


def _is_legacy(rec: Recommendation) -> bool:
    """results의 job_code가 하나라도 F 코드가 아니면 레거시(J/시나리오코드 기준)."""
    for r in rec.results or []:
        code = str(r.get("job_code", "")) if isinstance(r, dict) else ""
        if not F_CODE.fullmatch(code):
            return True
    return False


async def main() -> None:
    apply = "--yes" in sys.argv
    async with SessionFactory() as session:
        rows = (await session.execute(select(Recommendation))).scalars().all()
        legacy = [r for r in rows if _is_legacy(r)]
        print(f"추천 전체 {len(rows)}건 중 레거시 {len(legacy)}건")

        # 되돌릴 수 없는 삭제라 실행 전 전체 스냅샷을 남긴다 (컨테이너 /tmp — 실행 직후 회수할 것)
        backup = Path(f"/tmp/recommendations-backup-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json")
        backup.write_text(
            json.dumps(
                [
                    {
                        "id": r.id,
                        "user_id": r.user_id,
                        "consultation_id": r.consultation_id,
                        "results": r.results,
                        "feedback": r.feedback,
                        "created_at": r.created_at.isoformat(),
                    }
                    for r in legacy
                ],
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"백업: {backup} ({len(legacy)}건) — docker cp로 회수해 보관하세요")

        if not apply:
            print("dry-run — 삭제하려면 --yes 를 붙이세요")
            return
        if legacy:
            await session.execute(
                delete(Recommendation).where(Recommendation.id.in_([r.id for r in legacy]))
            )
            await session.commit()
        remain = (await session.execute(select(Recommendation))).scalars().all()
        print(f"삭제 완료: {len(legacy)}건 제거, 남은 추천 {len(remain)}건(전부 F 기준이어야 정상)")


if __name__ == "__main__":
    asyncio.run(main())
