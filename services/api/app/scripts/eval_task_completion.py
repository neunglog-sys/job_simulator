"""Task Completion — 세션이 깨지지 않고 끝까지 갔는가.

## 무엇을 재는 지표인가 (정의를 먼저 못 박는다)

가이드 9.4의 **시스템·비즈니스** 표에 TTFB·FPS·동시접속과 나란히 있는 항목이다.
즉 **세션 신뢰성**을 묻는다 — "사용자가 과제를 잘 풀었는가"가 아니다.

그래서 **스킵으로 끝난 판도 완주로 센다.** 스킵은 시스템이 정상 동작한 것이고
사용자의 선택이지 시스템의 실패가 아니다. (초기 버전은 이걸 실패로 세서 완주율이
3.4%로 나왔는데, 지표를 잘못 읽은 것이었다.)

과제를 실제로 풀어낸 비율은 **다른 질문**이라 아래 §과제 수행률로 따로 낸다.
두 값을 한 칸에 적으면 반드시 오해가 생긴다.


## active를 어떻게 볼 것인가

status는 active|completed|aborted 셋뿐이라, active에는 "지금 하는 중"과 "열어놓고
안 돌아온 판"이 섞여 있다. 앞은 실패가 아니고 뒤는 사실상 이탈이다. 섞은 채로 분모에
넣으면 방금 시작한 판이 곧바로 실패로 잡힌다.

마지막 액션 시각으로 가른다 — `--stale-hours`(기본 24) 이상 조용하면 **방치**로 본다.

    완주       completed (스킵 포함)
    중도포기    aborted — 사용자가 명시적으로 그만둠
    방치       active인데 오래 조용함 = 사실상 이탈
    진행 중     active이고 최근까지 활동 = 아직 안 끝남, 실패 아님

막힌 지점도 같이 낸다 — 비율만으로는 "어디서" 이탈하는지 알 수 없어 고칠 수가 없다.

## 범위 — 기본은 시연 시나리오 2개다

맵을 kts-03·sns-01 둘만 만들었으므로 나머지 시나리오는 **완성된 적이 없는 콘텐츠**다.
그걸 분모에 넣으면 완주율이 콘텐츠 미완성 탓에 낮아지고, 지표가 시스템을 설명하지
못한다(실측: 전체 576판 중 253판이 ms-06의 첫 미션에 멈춰 있다 — 시연에 없는 맵이다).

기본으로 DEMO_SLUGS만 잰다. 전체를 보려면 --all.

실행:
    docker compose exec api python -m app.scripts.eval_task_completion
    docker compose exec api python -m app.scripts.eval_task_completion --scenario kts-03
    docker compose exec api python -m app.scripts.eval_task_completion --all
"""

import argparse
import asyncio
import logging
from datetime import datetime, timezone
from collections import Counter, defaultdict

from sqlalchemy import select

from app.core.db import SessionFactory
from app.models import ActionLog, Scenario, Simulation

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


# 맵·콘텐츠가 완성된 시연 대상. 나머지는 미완성이라 완주율의 분모가 될 수 없다.
DEMO_SLUGS = ("kts-03", "sns-01")


async def collect(slugs: list[str] | None, since=None) -> dict:
    async with SessionFactory() as session:
        stmt = select(
            Simulation.id, Simulation.status, Simulation.state, Scenario.slug, Scenario.steps
        ).join(Scenario, Scenario.id == Simulation.scenario_id)
        if slugs:
            stmt = stmt.where(Scenario.slug.in_(slugs))
        if since is not None:
            stmt = stmt.where(Simulation.created_at >= since)
        sims = (await session.execute(stmt)).all()

        sim_ids = [s[0] for s in sims]
        actions: dict[int, list] = defaultdict(list)
        last_seen: dict[int, object] = {}
        if sim_ids:
            rows = (
                await session.execute(
                    select(
                        ActionLog.simulation_id, ActionLog.type,
                        ActionLog.payload, ActionLog.created_at,
                    )
                    .where(ActionLog.simulation_id.in_(sim_ids))
                    .order_by(ActionLog.id)
                )
            ).all()
            for sid, type_, payload, at in rows:
                actions[sid].append((type_, payload or {}))
                last_seen[sid] = at  # order_by id — 마지막이 최신

    return {"sims": sims, "actions": actions, "last_seen": last_seen}


def analyze(data: dict, stale_hours: float, now) -> dict:
    sims = data["sims"]
    actions = data["actions"]
    last_seen = data["last_seen"]

    status = Counter(s[1] for s in sims)
    completed = status["completed"]
    aborted = status["aborted"]

    # active를 '방치'와 '진행 중'으로 가른다 — 섞으면 방금 시작한 판이 실패로 잡힌다.
    stale = fresh = 0
    for sim_id, st, *_ in sims:
        if st != "active":
            continue
        at = last_seen.get(sim_id)
        if at is None:
            stale += 1  # 액션이 하나도 없다 = 만들어만 두고 안 들어옴
        elif (now - at).total_seconds() / 3600 >= stale_hours:
            stale += 1
        else:
            fresh += 1

    # 분모에서 '진행 중'만 뺀다. 방치는 끝내지 못한 것이므로 넣는다.
    attempted = completed + aborted + stale

    # 어디서 멈췄나 — 끝나지 않은 판의 현재 스텝. 비율만으로는 고칠 데를 못 찾는다.
    stuck: Counter = Counter()
    # 스킵으로 끝난 판 — Task Completion에서는 **성공**이다(시스템은 정상 동작했다).
    # 다만 '과제를 풀어냈는가'는 다른 질문이라, 그 지표를 따로 내기 위해 모아 둔다.
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
        # 완주했는데 제출 기록이 없는 판이 있다 — 전부 스킵으로 넘긴 경우다.
        # 분모에서 빠지면 비율이 100%를 넘으므로(실측 111.1%) 완주도 제출로 친다.
        if types & {"task_submit", "quest_submit", "choice", "minigame"} or st == "completed":
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
        "attempted": attempted,
        "stale": stale,
        "fresh": fresh,
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

    c = r["completed"]
    print(f"  전체 {r['total']}판")
    print(f"    완주      {c:>4}   (스킵으로 끝낸 판 포함 — 시스템은 정상 동작했다)")
    print(f"    중도포기   {r['aborted']:>4}   명시적으로 그만둠")
    print(f"    방치      {r['stale']:>4}   오래 조용함 = 사실상 이탈")
    print(f"    진행 중    {r['fresh']:>4}   최근까지 활동 — 실패가 아니라 분모에서 뺀다")

    print("\n── Task Completion (세션 신뢰성) " + "─" * 26)
    if r["attempted"]:
        rate = c / r["attempted"] * 100
        print(f"  완주율   {rate:5.1f}%   ({c}/{r['attempted']})")
        print(f"           분모 = 완주 {c} + 중도포기 {r['aborted']} + 방치 {r['stale']}")
        print(f"           진행 중 {r['fresh']}판은 제외 (아직 안 끝난 것이지 실패가 아니다)")
    else:
        print("  판정할 판이 없다 (전부 진행 중).")
    print("\n  ※ 이 지표는 '세션이 깨지지 않고 끝까지 갔는가'를 묻는다.")
    print("     스킵은 사용자의 선택이지 시스템의 실패가 아니므로 완주로 센다.")

    print("\n  참고 — 분모를 달리 잡으면:")
    for name, denom, note in (
        ("미션 제출 기준", r["submitted"], "미션을 한 번이라도 제출한 판"),
        ("진입 기준", r["touched"], "들어와서 뭐라도 한 판"),
        ("전체 기준", r["total"], "만들어진 시뮬레이션 전부(즉시 이탈 포함)"),
    ):
        if denom:
            print(f"    {name:<13} {c / denom * 100:5.1f}%   ({c}/{denom})  — {note}")
    print("  어느 값을 쓰든 **분모를 반드시 함께 적는다.**")

    if r["skipped"]:
        by_skip = c - r["completed_clean"]
        print("\n── 과제 수행률 (Task Completion과 다른 질문) " + "─" * 14)
        print("  '세션이 끝났는가'가 아니라 '과제를 풀어서 끝냈는가'를 본다.")
        print(f"  완주 {c}건 중 {by_skip}건이 스킵으로 끝났다 — 채점을 건너뛴 통과다.")
        if r["attempted"]:
            clean = r["completed_clean"] / r["attempted"] * 100
            print(f"\n  스킵 없이 완주   {clean:5.1f}%   ({r['completed_clean']}/{r['attempted']})")
        print(f"  스킵을 쓴 판(미완주 포함)  {r['skipped']}건")
        print("\n  ⚠️ 이 값을 Task Completion 칸에 적지 말 것 — 다른 지표다.")
        print("     콘텐츠 난이도·진행 흐름을 볼 때 쓴다.")

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
    parser.add_argument("--scenario", help="시나리오 slug 하나만 (예: kts-03)")
    parser.add_argument(
        "--since",
        help="이 날짜 이후 생성된 세션만 (YYYY-MM-DD). 기능이 완성된 시점부터 재려면 필수 — "
             "그 전 기록은 미완성 빌드에서 만들어진 것이라 같은 시스템이 아니다",
    )
    parser.add_argument(
        "--stale-hours", type=float, default=24.0,
        help="이만큼 조용하면 active를 '방치'로 본다 (기본 24시간)",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="시연 대상 밖까지 전부 — 맵 미완성 시나리오가 섞여 완주율이 낮게 나온다",
    )
    args = parser.parse_args()

    if args.scenario:
        slugs = [args.scenario]
    elif args.all:
        slugs = None
    else:
        slugs = list(DEMO_SLUGS)

    scope = "전체 시나리오" if slugs is None else " · ".join(slugs)
    logger.info("범위: %s", scope)
    if slugs is None:
        logger.info("⚠️ 맵이 없는 미완성 시나리오가 분모에 섞인다 — 시연 지표로 쓰지 말 것.")

    since = None
    if args.since:
        since = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        logger.info("기간: %s 이후 생성분", args.since)
    data = await collect(slugs, since)
    report(analyze(data, args.stale_hours, datetime.now(timezone.utc)))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
