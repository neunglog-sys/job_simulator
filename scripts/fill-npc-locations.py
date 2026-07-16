"""NPC 자리 배정을 데이터로 고정 — appearance.location에 spawn 자리 id 기록.

왜: 자리 배정이 키워드 추론(role/rank)에만 의존하면 콘텐츠 문구 수정만으로 NPC 위치가
조용히 뒤바뀐다. 이 스크립트는 현재 배정 로직의 결과를 각 NPC의 appearance.location에
써서 **데이터가 정답**이 되게 한다 (백엔드 assign_spawn_slots는 location을 최우선으로 봄).
특정 NPC 자리를 바꾸고 싶으면 이제 YAML의 location만 고치면 된다.

사용법 (호스트, repo 루트에서 — 컨테이너의 data/는 읽기전용):
  python scripts/fill-npc-locations.py [--check]

--check: 쓰지 않고 어떻게 배정될지만 출력.
재실행 안전(멱등): 이미 유효한 location(teamjang|sasu|bujang)이 있으면 존중하고 건너뜀.
build_scenarios로 npcs yaml을 재방출하면 location이 초기화되므로, 재방출 후 다시 실행할 것.
"""

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "api"))
from app.content.game_map import (  # noqa: E402
    NPC_SLOTS,
    assign_spawn_slots,
    load_scenario_game_map,
    map_info_for,
    npc_slots_in,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="NPC appearance.location에 자리 id 기록")
    parser.add_argument("--check", action="store_true", help="쓰지 않고 배정 결과만 출력")
    args = parser.parse_args()

    mapping = load_scenario_game_map()
    changed_files = 0

    for path in sorted(Path("data/npcs").glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        slug = doc.get("scenario_id")
        npcs = doc.get("npcs", [])
        if not npcs:
            continue

        # 이 시나리오 맵에 실제로 있는 자리 기준 (맵 없으면 표준 3종)
        info = map_info_for(slug) if slug in mapping else None
        slots = npc_slots_in(info["geometry"]) if info else NPC_SLOTS

        roster = [
            {
                "npc_id": n["npc_id"],
                "role": n.get("role"),
                "rank": n.get("rank"),
                "location": (n.get("appearance") or {}).get("location"),
            }
            for n in npcs
        ]
        assigned = assign_spawn_slots(roster, slots)

        dirty = False
        for n in npcs:
            appearance = n.setdefault("appearance", {})
            current = appearance.get("location")
            if current in NPC_SLOTS:  # 손으로 확정한 값은 존중
                continue
            new = assigned[n["npc_id"]]
            if current != new:
                if args.check:
                    print(f"  {slug} {n['npc_id']} ({n.get('role')}): {current!r} → {new}")
                appearance["location"] = new
                dirty = True

        if dirty and not args.check:
            # 헤더 주석 유지: 원본에서 앞부분 주석 줄들만 살려 붙임
            original = path.read_text(encoding="utf-8").splitlines()
            header = [ln for ln in original[:5] if ln.startswith("#")]
            body = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=120)
            path.write_text("\n".join(header) + ("\n" if header else "") + body, encoding="utf-8")
            changed_files += 1
            print(f"✏️  {path.name}")

    print(f"\n{'검토만 (미적용)' if args.check else f'{changed_files}개 파일 갱신'} 완료")


if __name__ == "__main__":
    main()
