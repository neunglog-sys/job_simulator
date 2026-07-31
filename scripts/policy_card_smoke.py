"""정책 카드 수동 점검 — 실제 정부 API + LLM을 그대로 태워 결과를 눈으로 본다.

    docker compose exec api python scripts/policy_card_smoke.py

자동 테스트로 만들지 않은 이유: 외부 API·LLM에 의존해 결과가 매번 달라진다.
회귀 검증이 아니라 "지금 어떤 문구가 나오는지" 확인하는 용도다.
"""

import asyncio
import os
import sys
from pathlib import Path

# 컨테이너(CWD=/app)와 레포 루트 양쪽에서 돌아가게 — app 패키지가 있는 경로를 찾아 넣는다.
for candidate in (Path.cwd(), Path(__file__).resolve().parents[1] / "services" / "api"):
    if (candidate / "app").is_dir():
        sys.path.insert(0, str(candidate))
        break

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from app.domains.policy import service  # noqa: E402

# 조건 축(나이대·성별·장애·지역 유무)이 서로 다른 케이스로 구성 — 한쪽으로 쏠린 결과가
# 나오지 않는지, 조건이 실제로 결과를 가르는지 눈으로 확인하기 위함.
PROFILES = [
    (
        "① 만24 · 여성 · 장애없음 · 서울 관악 (사회초년생)",
        dict(age=24, gender="female", has_disability=False, ctpv="서울특별시", sgg="관악구"),
    ),
    (
        "② 만27 · 여성 · 장애있음 · 서울 노원",
        dict(age=27, gender="female", has_disability=True, ctpv="서울특별시", sgg="노원구"),
    ),
    (
        "③ 만33 · 남성 · 장애없음 · 경기 양주",
        dict(age=33, gender="male", has_disability=False, ctpv="경기도", sgg="양주시"),
    ),
    (
        "④ 만47 · 남성 · 장애없음 · 부산 해운대 (중장년 전직)",
        dict(age=47, gender="male", has_disability=False, ctpv="부산광역시", sgg="해운대구"),
    ),
    (
        "⑤ 조건 미입력 (프로필 비어있는 사용자)",
        dict(age=None, gender=None, has_disability=None, ctpv=None, sgg=None),
    ),
]


async def main() -> None:
    for label, profile in PROFILES:
        print("=" * 78)
        print(f"■ {label}")
        candidates = await service.collect_candidates(**profile)
        print(f"  후보 {len(candidates)}건")
        for c in candidates[:5]:
            print(f"   - [{c['scope']:8}] {c['name']}")

        card = await service.build_card(**profile)
        print("\n  ── LLM 카드 ──")
        if not card:
            print("  (카드 없음)")
        else:
            print(f"  {card['title']}")
            print(f"  {card['body']}")
            cited = card.get("cited") or []
            print(f"  ✔ 인용 검증: 후보에 실재하는 제도 {len(cited)}건 — "
                  + ", ".join(c["name"] for c in cited))
            print(f"  더 알아보기: {card['more_url'][:70]}  (근거 {card['source_count']}건)")
        print()


if __name__ == "__main__":
    asyncio.run(main())
