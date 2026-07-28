"""진행 불가 지점 검사 — 시스템이 사용자를 막아 세우는 곳이 있는가.

## 무엇을 묻는 검사인가

이탈률(사용자가 스스로 나가는 비율)은 실사용자 없이는 못 잰다. 하지만 **시스템이 막아서
못 나아가는 지점**은 사용자 없이도 찾을 수 있고, 그게 지금 우리가 알아야 할 것이다.
2차 때 "끝까지 개발 못 한 팀"을 가리려는 지표라면 묻는 것도 이쪽이다.

자동 완주 8/8(run_eval_sessions)은 **백엔드만** 통과한 결과다. 프론트에서 걸어가고
클릭해야 열리는 관문은 안 탔다. 여기서 그 나머지를 데이터·좌표로 확인한다.

## 검사 항목

    ① 스텝 체인      on_pass/on_complete를 따라가면 끝(END)에 닿는가. 막다른 스텝·순환
    ② 과제 데이터    choice/checklist/order에 정답과 보기가 있는가 (없으면 통과 불가)
    ③ 미니게임      스텝이 부르는 game_id가 실제로 정의돼 있는가
    ④ NPC 도달성    플레이어 스폰에서 걸어서 각 미션 NPC의 대화 반경까지 갈 수 있는가
                    (게임과 같은 판정: 발박스 46×26, 충돌 사각형, 경로탐색 없음)

④가 핵심이다. 경로탐색이 없어 직선이 막히면 못 간다 — 미션 NPC가 막힌 자리에 있으면
그 판은 거기서 끝난다. 사용자가 포기한 게 아니라 시스템이 막은 것이다.

실행:
    docker compose exec api python -m app.scripts.check_flow_blockers
"""

import argparse
import asyncio
import logging
from collections import deque

from sqlalchemy import select

from app.content import game_map, minigame
from app.core.db import SessionFactory
from app.domains.simulation import service as sim_service
from app.models import Scenario

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

DEMO_SLUGS = ("kts-03", "sns-01")

# 프론트 판정과 같은 값 (MovementArea.tsx) — 여기가 어긋나면 검사가 거짓말을 한다.
FOOT_W, FOOT_H = 46, 26
TALK_RADIUS = 140
STEP = 8


def _blocked(x: float, y: float, cols: list[dict], bounds: tuple) -> bool:
    """x,y = 플레이어 발밑(바텀센터). 게임과 같은 발박스 충돌."""
    minx, miny, maxx, maxy = bounds
    fx, fy = x - FOOT_W / 2, y - FOOT_H
    if fx < minx - 200 or fy < miny - 200 or fx + FOOT_W > maxx + 200 or fy + FOOT_H > maxy + 200:
        return True
    return any(
        fx < c["x"] + c["w"] and fx + FOOT_W > c["x"]
        and fy < c["y"] + c["h"] and fy + FOOT_H > c["y"]
        for c in cols
    )


def reachable_from(geometry: dict) -> list[tuple[int, int]]:
    """플레이어 스폰에서 걸어서 닿는 지점들. 경로탐색이 없어도 인접 이동은 가능하므로
    flood fill이 '갈 수 있는 곳'의 상한이 된다 — 여기서도 못 닿으면 확실히 막힌 것이다."""
    cols = geometry.get("collision") or []
    walk = geometry.get("walkable") or []
    if not walk:
        return []
    bounds = (
        min(r["x"] for r in walk), min(r["y"] for r in walk),
        max(r["x"] + r["w"] for r in walk), max(r["y"] + r["h"] for r in walk),
    )
    spawns = {s.get("id"): (s.get("x"), s.get("y")) for s in geometry.get("spawns", [])}
    start = spawns.get("player")
    if not start:
        return []
    seen = {(start[0] // STEP, start[1] // STEP)}
    q = deque([start])
    out = []
    while q:
        x, y = q.popleft()
        out.append((x, y))
        for dx, dy in ((STEP, 0), (-STEP, 0), (0, STEP), (0, -STEP)):
            nx, ny = x + dx, y + dy
            k = (nx // STEP, ny // STEP)
            if k in seen:
                continue
            seen.add(k)
            if not _blocked(nx, ny, cols, bounds):
                q.append((nx, ny))
    return out


async def check(slug: str) -> list[str]:
    """이 시나리오에서 진행이 막히는 지점들. 빈 리스트면 막힘 없음."""
    issues: list[str] = []
    async with SessionFactory() as session:
        scenario = (
            await session.execute(select(Scenario).where(Scenario.slug == slug))
        ).scalar_one_or_none()
        if scenario is None:
            return [f"시나리오 없음: {slug}"]
        # 게임과 같은 헬퍼를 쓴다 — 자리 배정이 순서 의존이라 직접 조회하면 위치가 달라진다
        roster = await sim_service.npc_map(session, scenario.id)

    steps = {s["id"]: s for s in scenario.steps}
    order = [s["id"] for s in scenario.steps]

    # ① 스텝 체인 — 첫 스텝에서 출발해 끝에 닿는가
    seen: set[str] = set()
    cur = order[0] if order else None
    while cur:
        if cur in seen:
            issues.append(f"스텝 체인 순환: {cur} — 같은 스텝으로 되돌아온다")
            break
        seen.add(cur)
        st = steps.get(cur)
        if st is None:
            issues.append(f"존재하지 않는 스텝을 가리킴: {cur}")
            break
        activity = st.get("activity") or {}
        task = st.get("task") or {}
        nxt = activity.get("on_complete") if activity else task.get("on_pass")
        if nxt in (None, "__end__", "__reflection__"):
            break
        if nxt not in steps:
            issues.append(f"{cur} → '{nxt}' 로 넘어가는데 그런 스텝이 없다 — 여기서 막힌다")
            break
        cur = nxt
    unreached = [s for s in order if s not in seen]
    if unreached:
        issues.append(f"체인에서 안 닿는 스텝: {unreached} (도달 불가 콘텐츠)")

    # ② 과제 데이터 — 정답·보기가 없으면 통과 자체가 불가능
    for sid, st in steps.items():
        task = st.get("task") or {}
        kind = task.get("kind")
        if kind in ("choice", "checklist", "order"):
            answer = task.get("answer") or {}
            has = answer.get("key") if kind == "choice" else answer.get("keys")
            if not has:
                issues.append(f"{sid} ({kind}) 정답 없음 — 무엇을 내도 통과 불가")
            if not (task.get("options") or []):
                issues.append(f"{sid} ({kind}) 보기 없음 — 제출할 수단이 없다")

    # ③ 미니게임 정의
    defined = {
        (g.get("id") or g.get("game_id")) for g in (minigame.minigames_for(slug) or [])
    }
    for sid, st in steps.items():
        act = st.get("activity") or {}
        if act.get("kind") == "minigame":
            gid = act.get("game_id")
            if gid not in defined:
                issues.append(f"{sid} 미니게임 '{gid}' 정의 없음 — 창이 안 뜨면 여기서 끝난다")

    # ④ NPC 도달성 — 걸어서 대화 반경까지 갈 수 있는가
    map_info = game_map.map_info_for(slug)
    geometry = (map_info or {}).get("geometry")
    if not geometry:
        issues.append("맵 좌표 없음 — 이동·접근을 검사할 수 없다")
        return issues

    reach = reachable_from(geometry)
    if not reach:
        issues.append("플레이어 스폰에서 갈 수 있는 곳이 없다 — 시작 지점이 막혔다")
        return issues

    slots = game_map.npc_slots_in(geometry)
    assignment = game_map.assign_spawn_slots(list(roster.values()), slots)
    spawn_xy = {s.get("id"): (s.get("x"), s.get("y")) for s in geometry.get("spawns", [])}
    names = {k: v["name"] for k, v in roster.items()}

    for sid, st in steps.items():
        for npc_id in st.get("npcs") or []:
            slot = assignment.get(npc_id)
            xy = spawn_xy.get(slot)
            if not xy:
                issues.append(f"{sid} NPC {names.get(npc_id, npc_id)} 자리 없음({slot})")
                continue
            best = min(reach, key=lambda p: (p[0] - xy[0]) ** 2 + (p[1] - xy[1]) ** 2)
            d = ((best[0] - xy[0]) ** 2 + (best[1] - xy[1]) ** 2) ** 0.5
            if d > TALK_RADIUS:
                issues.append(
                    f"{sid} NPC {names.get(npc_id, npc_id)}({slot})에 걸어서 못 간다 — "
                    f"최근접 {d:.0f}px (대화 반경 {TALK_RADIUS}px). **여기서 진행 불가**"
                )
    return issues


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", action="append", help="검사할 시나리오 (여러 번 가능)")
    args = parser.parse_args()
    slugs = args.slug or list(DEMO_SLUGS)

    print("=" * 60)
    print(" 진행 불가 지점 검사")
    print("=" * 60)
    print("  '사용자가 나갔는가'가 아니라 '시스템이 막았는가'를 본다.")

    total = 0
    for slug in slugs:
        issues = await check(slug)
        total += len(issues)
        print(f"\n── {slug} " + "─" * (52 - len(slug)))
        if not issues:
            print("  막히는 지점 없음 ✅")
        for i in issues:
            print(f"  🔴 {i}")

    print("\n" + "=" * 60)
    if total == 0:
        print(" 결론: 시스템이 강제로 막아 세우는 지점 0건")
        print(" (이탈률은 별개 — 사용자가 스스로 나가는 비율은 실사용자가 있어야 잰다)")
    else:
        print(f" 결론: 진행 불가 지점 {total}건 — 위 항목을 먼저 해결해야 한다")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
