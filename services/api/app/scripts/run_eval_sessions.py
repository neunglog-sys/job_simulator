"""평가용 세션 자동 완주 — 깨끗한 코호트를 만들고 그 위에서 지표를 낸다.

## 이 숫자를 어떻게 읽어야 하나 (먼저 못 박는다)

정답을 알고 넣으므로 **완주율은 100%로 나온다.** 그건 측정이 아니라 동어반복이다.
따라서 이 스크립트의 산출물은 완주율이 아니라 다음 셋이다.

    ① 완주 검증      N/N — 플로우가 끝까지 완결되는가 (막히면 여기서 드러난다)
    ② 성능 베이스라인  스텝별 소요시간·채점 지연 — 정답을 알아도 이건 실측값이다
    ③ 채점기 동작     정답 제출이 실제로 통과 판정을 받는가, 몇 점이 나오는가

보고서에 쓸 때는 "자동 완주 검증 8/8 성공"이라고 적는다. "완주율 100%"로 적으면
사용자 행동 지표로 오해되고, 어떻게 돌렸냐고 물으면 그 자리에서 무너진다.

## 기존 데이터와 섞이지 않게

전용 계정(EVAL_EMAIL)으로만 돌린다. 나중에 이 코호트만 골라내려면 그 계정으로 필터하면
된다. 공용 DB에 행이 쌓이므로 필요 이상으로 돌리지 않는다.

## 프론트를 거치지 않는다

서비스 계층을 직접 호출한다(= WS 라우터와 같은 함수). 채점·상태전이·리포트 연결은
그대로 타지만, **걷기·클릭 같은 프론트 게이트는 안 탄다.** 즉 백엔드 플로우의 완결성을
재는 것이지 UI 조작성을 재는 게 아니다.

실행:
    docker compose exec api python -m app.scripts.run_eval_sessions --per-map 4 --workers 4
"""

import argparse
import asyncio
import logging
import statistics
import time

from sqlalchemy import select

from app.core.db import SessionFactory
from app.core.crypto import email_hash
from app.core.security import hash_password
from app.content import materials as materials_mod
from app.domains.simulation import service
from app.llm import get_llm
from app.llm.base import ChatMessage
from app.models import User

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

DEMO_SLUGS = ("kts-03", "sns-01")
EVAL_EMAIL = "eval-runner@jobiverse.local"

# 서술형(write) 답안은 LLM이 쓴다.
#
# 처음엔 고정 템플릿을 썼는데 30~33점으로 계속 떨어졌다(합격선 70). 채점이 자료의 핵심
# 사실과 채점 기준을 하나씩 확인하는 방식이라, 틀에 cause만 끼워 넣은 답으로는 안 된다.
# 그래서 **자료와 채점 기준을 주고 답안을 작성하게** 한다 — 실제 사용자가 자료를 읽고
# 쓰는 경로와 같아지고, 정답을 외워 넣는 것도 아니다.
WRITE_SYSTEM = """너는 신입사원이다. 사수에게 낼 짧은 업무 보고를 쓴다.

- 제공된 자료에서 확인되는 **사실과 수치를 그대로 인용**한다. 자료에 없는 건 쓰지 않는다.
- 아래 채점 기준을 **하나도 빠짐없이** 다룬다.
- 6~10문장. 번호를 매겨 항목별로 쓴다.
- 모르는 것은 '확인 필요'로 남긴다. 지어내지 않는다."""

MAX_TASK_ATTEMPTS = 2  # 두 번 떨어지면 그 판은 실패로 남긴다 — 무한 재시도는 비용만 태운다


async def _eval_user(session) -> User:
    user = (
        await session.execute(select(User).where(User.email_hash == email_hash(EVAL_EMAIL)))
    ).scalar_one_or_none()
    if user is None:
        user = User(
            email=EVAL_EMAIL,
            email_hash=email_hash(EVAL_EMAIL),
            pw_hash=hash_password("eval-runner-not-for-login"),
            name="평가 러너",
        )
        session.add(user)
        await session.commit()
        logger.info("평가 전용 계정 생성: %s (id=%s)", EVAL_EMAIL, user.id)
    return user


def _answer_for(task: dict):
    """checklist/choice/order는 시나리오에 정답이 있다. write는 None → LLM이 쓴다."""
    kind = task.get("kind")
    answer = task.get("answer") or {}
    if kind in ("checklist", "order"):
        return list(answer.get("keys") or [])
    if kind == "choice":
        # 문자열로 보낸다 — 배열이면 _parse_selection이 그대로 받지만, 계약상
        # 하나만 고르는 과제라 단일 값이 의도를 더 정확히 드러낸다.
        return str(answer.get("key") or "")
    return None


async def _write_answer(task: dict, docs: list[dict]) -> str:
    """자료와 채점 기준을 주고 보고문을 작성하게 한다."""
    material = "\n\n".join(f"[{d['title']}]\n{d['body']}" for d in docs) or "(자료 없음)"
    criteria = "\n".join(f"- {c}" for c in (task.get("criteria") or []))
    prompt = (
        f"[업무 지시]\n{task.get('prompt', '')}\n\n"
        f"[제공 자료]\n{material}\n\n"
        f"[채점 기준 — 전부 다뤄야 한다]\n{criteria}"
    )
    return await get_llm().chat(
        [ChatMessage(role="user", content=prompt)], system=WRITE_SYSTEM, temperature=0.3
    )


async def run_session(slug: str, tag: str) -> dict:
    """한 판을 끝까지 몬다. 반환값은 지표 산출용 기록."""
    t0 = time.perf_counter()
    marks: list[dict] = []
    tries: dict[str, int] = {}
    async with SessionFactory() as session:
        user = await _eval_user(session)
        sim, scenario = await service.create_simulation(session, user, slug)

        await service.finish_tour(session, sim, scenario)

        guard = 0
        while sim.status == "active" and guard < 30:
            guard += 1
            state = dict(sim.state)
            if state.get("workflow_stage") == "reflection":
                break
            step = service._resolve_step(scenario, state)
            activity = step.get("activity") or {}
            task = step.get("task") or {}
            s0 = time.perf_counter()

            if activity.get("kind") == "minigame":
                await service.complete_activity(
                    session, sim, scenario,
                    {"game_id": activity.get("game_id")},
                )
                kind, passed, score = "minigame", True, None
            elif activity.get("kind") == "debrief":
                await service.complete_activity(
                    session, sim, scenario,
                    {"content": "자료를 먼저 확인하고 순서를 정한 점이 도움이 됐습니다."},
                )
                kind, passed, score = "debrief", True, None
            elif task:
                # 돌발 퀘스트가 활성이면 채점 대상이 본편이 아니라 퀘스트다.
                # _resolve_step은 본편 스텝을 돌려주는데 submit_task는 _submit_quest로
                # 보내므로, 본편 정답을 그대로 내면 엉뚱한 답이 된다(실측: m2 정답 'd'를
                # 냈는데 퀘스트 정답 'a' 기준으로 0점, m1 체크리스트 5개를 냈더니
                # '보기를 하나만 선택하세요' 400).
                if (state.get("quest") or {}).get("status") == "active":
                    task = (scenario.sudden_quest or {}).get("task") or task
                kind = task.get("kind") or "write"
                content = _answer_for(task)
                if content is None:  # write — 자료를 읽고 LLM이 작성
                    chosen = service._material_set_for(scenario, state, step["id"]) or {}
                    docs = materials_mod.public_documents(chosen) if chosen else []
                    content = await _write_answer(task, docs)
                try:
                    result = await service.submit_task(session, sim, scenario, content)
                except Exception:
                    # 어느 스텝에서 무엇을 보내다 터졌는지 남긴다 — 이게 없으면 재현이 안 된다
                    logger.warning(
                        "[%s] 제출 실패 step=%s kind=%s quest=%s content=%r",
                        tag, step["id"], kind,
                        (state.get("quest") or {}).get("status"), content,
                    )
                    raise
                passed = bool(result.get("passed"))
                score = result.get("total")
                # 같은 스텝을 무한히 다시 풀지 않는다 — 두 번 떨어지면 그 판을 접는다.
                if not passed:
                    tries[step["id"]] = tries.get(step["id"], 0) + 1
                    if tries[step["id"]] >= MAX_TASK_ATTEMPTS:
                        logger.warning(
                            "[%s] %s %d회 미통과(%s점) — 이 판 중단", tag, step["id"],
                            tries[step["id"]], score,
                        )
                        marks.append({"step": step["id"], "kind": kind, "passed": False,
                                      "score": score, "ms": (time.perf_counter() - s0) * 1000})
                        break
            else:
                logger.warning("[%s] %s — 처리할 게 없다, 중단", tag, step["id"])
                break

            marks.append({
                "step": step["id"], "kind": kind, "passed": passed, "score": score,
                "ms": (time.perf_counter() - s0) * 1000,
            })
            await session.refresh(sim)

        reflected = False
        if dict(sim.state).get("workflow_stage") == "reflection":
            await service.save_reflection(
                session, sim,
                "직접 자료를 대조하며 판단하는 과정이 실제 업무와 비슷하게 느껴졌습니다.",
                scenario,
            )
            reflected = True
            await session.refresh(sim)

        return {
            "tag": tag, "slug": slug, "sim_id": sim.id, "status": sim.status,
            "reflected": reflected, "marks": marks,
            "total_ms": (time.perf_counter() - t0) * 1000,
        }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-map", type=int, default=4)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    jobs = [(slug, f"{slug}#{i + 1}") for slug in DEMO_SLUGS for i in range(args.per_map)]
    logger.info("세션 %d판 (맵당 %d) · 워커 %d개", len(jobs), args.per_map, args.workers)
    logger.info("⚠️ 공용 DB에 %d행이 쌓인다. 전용 계정(%s)으로 구분된다.", len(jobs), EVAL_EMAIL)

    sem = asyncio.Semaphore(args.workers)

    async def guarded(slug, tag):
        async with sem:
            try:
                r = await run_session(slug, tag)
                logger.info("  %-12s sim %-5s %s", tag, r["sim_id"], r["status"])
                return r
            except Exception as e:  # noqa: BLE001 — 한 판 실패가 전체를 멈추면 안 된다
                logger.warning("  %-12s 실패: %s: %s", tag, type(e).__name__, e)
                return {"tag": tag, "slug": slug, "status": "error", "error": str(e), "marks": []}

    results = await asyncio.gather(*(guarded(s, t) for s, t in jobs))
    report(results)
    return 0


def report(results: list[dict]) -> None:
    done = [r for r in results if r.get("status") == "completed"]
    print("\n" + "=" * 60)
    print(f" 자동 완주 검증 — {len(done)}/{len(results)} 성공")
    print("=" * 60)
    for slug in DEMO_SLUGS:
        rs = [r for r in results if r["slug"] == slug]
        ok = [r for r in rs if r.get("status") == "completed"]
        print(f"  {slug:8} {len(ok)}/{len(rs)} 완주")
        for r in rs:
            if r.get("status") != "completed":
                print(f"    ✗ {r['tag']}  {r.get('error', r.get('status'))}")

    fails = [m for r in results for m in r["marks"] if m["passed"] is False]
    if fails:
        print(f"\n  ⚠️ 채점 미통과 {len(fails)}건 — 정답 제출인데 떨어졌다면 채점기를 봐야 한다")
        for m in fails[:10]:
            print(f"    {m['step']} ({m['kind']}) {m['score']}점")

    print("\n── 스텝별 소요시간 (정답을 알아도 이건 실측이다) " + "─" * 10)
    by_kind: dict[str, list[float]] = {}
    for r in results:
        for m in r["marks"]:
            by_kind.setdefault(m["kind"], []).append(m["ms"])
    for kind, vals in sorted(by_kind.items(), key=lambda kv: -statistics.mean(kv[1])):
        print(f"  {kind:12} n={len(vals):<3} 평균 {statistics.mean(vals):7.0f}ms · "
              f"최대 {max(vals):7.0f}ms")

    if done:
        totals = [r["total_ms"] for r in done]
        print(f"\n  판당 전체    평균 {statistics.mean(totals) / 1000:.1f}s · "
              f"최대 {max(totals) / 1000:.1f}s")
    print("\n  ※ 보고 시 표기: '자동 완주 검증 N/N 성공'.")
    print("     '완주율 100%'로 적으면 사용자 행동 지표로 오해된다.")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
