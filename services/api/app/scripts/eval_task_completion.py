"""Task Completion — 체험을 시작한 사람이 실제로 끝까지 갔는가.

v2 보고서는 **48.9%(시도) · 11.5%(전체)** 두 값을 나란히 싣는데, 분모가 달라서 그렇다.
분모를 안 밝히면 같은 시스템이 4배 차이로 보인다. 여기서 분모를 코드로 고정한다.

    시도 기준   완주 / (완주 + 중도포기)      = 시작한 판 중 끝난 비율
    전체 기준   완주 / 전체 시뮬레이션        = active(진행 중)까지 분모에 넣은 값

**시도 기준이 기본**이다. active는 "아직 안 끝난 것"이지 "실패한 것"이 아니라서, 분모에
넣으면 방금 시작한 판이 곧바로 실패로 잡힌다. 전체 기준은 참고로만 함께 낸다.

막힌 지점도 같이 낸다 — 비율만으로는 "어디서" 이탈하는지 알 수 없어 고칠 수가 없다.

실행:
    docker compose exec api python -m app.scripts.eval_task_completion
    docker compose exec api python -m app.scripts.eval_task_completion --scenario kts-03
"""

import argparse
import asyncio
import logging
from collections import Counter, defaultdict

from sqlalchemy import select

from app.core.db import SessionFactory
from app.models import ActionLog, Scenario, Simulation

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


async def collect(scenario_slug: str | None) -> dict:
    async with SessionFactory() as session:
        stmt = select(
            Simulation.id, Simulation.status, Simulation.state, Scenario.slug, Scenario.steps
        ).join(Scenario, Scenario.id == Simulation.scenario_id)
        if scenario_slug:
            stmt = stmt.where(Scenario.slug == scenario_slug)
        sims = (await session.execute(stmt)).all()

        sim_ids = [s[0] for s in sims]
        actions: dict[int, list] = defaultdict(list)
        if sim_ids:
            rows = (
                await session.execute(
                    select(ActionLog.simulation_id, ActionLog.type, ActionLog.payload)
                    .where(ActionLog.simulation_id.in_(sim_ids))
                    .order_by(ActionLog.id)
                )
            ).all()
            for sid, type_, payload in rows:
                actions[sid].append((type_, payload or {}))

    return {"sims": sims, "actions": actions}


def analyze(data: dict) -> dict:
    sims = data["sims"]
    actions = data["actions"]

    status = Counter(s[1] for s in sims)
    completed = status["completed"]
    aborted = status["aborted"]
    active = status["active"]
    attempted = completed + aborted

    # 어디서 멈췄나 — 끝나지 않은 판의 현재 스텝. 비율만으로는 고칠 데를 못 찾는다.
    stuck: Counter = Counter()
    # 스킵으로 통과한 판은 '풀어서' 끝낸 게 아니다. 섞이면 완주율이 부풀려진다.
    skipped_sims = set()
    # 분모 후보 — 뭘 '시도'로 볼지에 따라 완주율이 몇 배씩 달라진다. 하나만 고르지 않고
    # 전부 내놓되 각각 이름을 붙인다.
    touched = set()    # 들어와서 뭐라도 한 판
    submitted = set()  # 미션을 실제로 제출한 판
    for sim_id, st, state, slug, _steps in sims:
        if st != "completed":
            step = (state or {}).get("step") or "(시작 전)"
            stuck[f"{slug}:{step}"] += 1
        types = {t for t, _ in actions.get(sim_id, [])}
        if types:
            touched.add(sim_id)
        if types & {"task_submit", "quest_submit", "choice", "minigame"}:
            submitted.add(sim_id)
        if "skip_step" in types:
            skipped_sims.add(sim_id)

    completed_clean = sum(
        1 for sim_id, st, *_ in sims if st == "completed" and sim_id not in skipped_sims
    )

    # 스텝 도달률 — 시나리오별로 몇 번째 미션에서 사람이 빠지는지
    reach: dict[str, Counter] = defaultdict(Counter)
    for sim_id, st, state, slug, steps in sims:
        order = [s["id"] for s in (steps or [])]
        cur = (state or {}).get("step")
        idx = order.index(cur) if cur in order else (len(order) if st == "completed" else -1)
        for i, sid in enumerate(order):
            if i <= idx:
                reach[slug][sid] += 1

    return {
        "total": len(sims),
        "completed": completed,
        "completed_clean": completed_clean,
        "aborted": aborted,
        "active": active,
        "attempted": attempted,
        "touched": len(touched),
        "submitted": len(submitted),
        "skipped": len(skipped_sims),
        "stuck": stuck,
        "reach": reach,
        "sims": sims,
    }


def report(r: dict) -> None:
    print("=" * 60)
    print(" Task Completion")
    print("=" * 60)
    if not r["total"]:
        print("  시뮬레이션 데이터가 없다.")
        return

    print(f"  전체 {r['total']}판 — 완주 {r['completed']} · 중도포기 {r['aborted']} · "
          f"진행 중 {r['active']}")

    c = r["completed"]
    print("\n── 완주율 — 분모를 무엇으로 잡느냐에 달렸다 " + "─" * 16)
    for name, denom, note in (
        ("끝난 판 기준", r["attempted"], "완주+중도포기. 진행 중은 뺀다 — 아직 안 끝난 것이지 실패가 아니다"),
        ("미션 제출 기준", r["submitted"], "미션을 한 번이라도 제출한 판"),
        ("진입 기준", r["touched"], "들어와서 뭐라도 한 판"),
        ("전체 기준", r["total"], "만들어진 시뮬레이션 전부(즉시 이탈 포함)"),
    ):
        if denom:
            print(f"  {name:<13} {c / denom * 100:5.1f}%   ({c}/{denom})")
            print(f"  {'':13}   └ {note}")
    print("\n  ⚠️ 어느 값을 쓰든 **분모를 반드시 함께 적는다.** 위에서 보듯 같은 시스템이")
    print("     10%대에서 90%대까지 나온다. 분모 없는 완주율은 아무 뜻이 없다.")

    if r["skipped"]:
        by_skip = r["completed"] - r["completed_clean"]
        print(f"\n── 🔴 완주 {r['completed']}건 중 {by_skip}건이 '스킵'으로 끝났다 " + "─" * 12)
        print("  스킵은 채점을 건너뛰고 통과 처리하는 테스트용 버튼이다(현재는 기본 차단).")
        print("  이 판들은 과제를 **풀어서** 끝낸 게 아니라, 완주로 세면 지표가 부풀려진다.")
        if r["attempted"]:
            clean = r["completed_clean"] / r["attempted"] * 100
            print(f"\n  스킵 제외 · 끝난 판 기준   {clean:5.1f}%   "
                  f"({r['completed_clean']}/{r['attempted']})  ← 보고에는 이 값을 쓴다")
        print(f"  스킵을 쓴 판(미완주 포함)  {r['skipped']}건")

    if r["stuck"]:
        print("\n── 어디서 멈췄나 (끝나지 않은 판의 현재 스텝) " + "─" * 14)
        for key, n in r["stuck"].most_common(10):
            print(f"  {n:>3}판  {key}")
        print("  → 한 스텝에 몰려 있으면 그 미션이 병목이다. 비율보다 여기를 먼저 본다.")

    for slug, counter in r["reach"].items():
        if not counter:
            continue
        print(f"\n── 스텝 도달률 · {slug} " + "─" * max(0, 38 - len(slug)))
        base = max(counter.values())
        for sid, n in counter.items():
            bar = "█" * round(n / base * 24)
            print(f"  {sid:<6} {n:>3}판 {bar}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", help="시나리오 slug (예: kts-03). 생략하면 전체")
    args = parser.parse_args()

    data = await collect(args.scenario)
    report(analyze(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
