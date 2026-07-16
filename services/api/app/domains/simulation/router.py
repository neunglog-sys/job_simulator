import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content import game_map
from app.core.db import SessionFactory, get_session
from app.core.deps import get_current_user, resolve_user
from app.domains.scoring import aggregate
from app.domains.simulation import service
from app.domains.simulation.schemas import SimulationCreate, SimulationOut
from app.models import Job, Scenario, Simulation, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["simulation"])


@router.get("/api/scenarios")
async def list_scenarios(session: AsyncSession = Depends(get_session)):
    """시나리오 목록 — 프론트 맵 화면용 (module로 배경 세트 선택).

    필요한 컬럼만 조회 (steps 등 대형 JSONB 제외). 돌발 퀘스트 보유 여부는
    서프라이즈 스포일러라 노출하지 않는다.
    """
    rows = (
        await session.execute(
            select(Scenario.slug, Scenario.title, Scenario.module, Job.code, Job.title)
            .join(Job, Scenario.job_id == Job.id)
            .order_by(Scenario.slug)
        )
    ).all()
    game_maps = game_map.load_scenario_game_map()  # slug → 맵 폴더 (미배정이면 없음)
    return [
        {
            "slug": slug, "title": title, "module": module,
            "job_code": code, "job_title": jtitle,
            "map_id": game_maps.get(slug),  # null이면 module 배경 폴백
        }
        for slug, title, module, code, jtitle in rows
    ]


@router.get("/api/simulations")
async def list_simulations(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """내 시뮬레이션 목록 (최신순) — 메인화면 이어하기·체험 기록용."""
    rows = (
        await session.execute(
            select(Simulation, Scenario)
            .join(Scenario, Simulation.scenario_id == Scenario.id)
            .where(Simulation.user_id == user.id)
            .order_by(Simulation.id.desc())
        )
    ).all()
    return [
        {
            "id": sim.id,
            "scenario_slug": sc.slug,
            "scenario_title": sc.title,
            "module": sc.module,
            "status": sim.status,  # active=이어하기 / completed=결과 보기 / aborted
            "current_step": sim.state.get("step"),
            "total": (sim.state.get("score") or {}).get("total"),  # 완주 시에만
            "created_at": sim.created_at.isoformat(),
        }
        for sim, sc in rows
    ]


@router.post("/api/simulations", response_model=SimulationOut, status_code=201)
async def create_simulation(
    body: SimulationCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.create_simulation(session, user, body.scenario_slug)
    return await service.to_out(session, simulation, scenario)


@router.get("/api/simulations/{simulation_id}", response_model=SimulationOut)
async def get_simulation(
    simulation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.get_owned_simulation(session, simulation_id, user)
    return await service.to_out(session, simulation, scenario)


@router.post("/api/simulations/{simulation_id}/finish", response_model=SimulationOut)
async def finish_simulation(
    simulation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.get_owned_simulation(session, simulation_id, user)
    simulation = await service.finish_simulation(session, simulation, scenario)
    return await service.to_out(session, simulation, scenario)


@router.get("/api/simulations/{simulation_id}/score")
async def get_score(
    simulation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """정밀 점수제 집계 — 미션별 인정점수·시나리오 총점·역량 5종 + 백분위 뱃지.

    진행 중이면 부분 집계. top_percent는 모수 30명 미만이면 null (프론트: 숨김).
    """
    simulation, scenario = await service.get_owned_simulation(session, simulation_id, user)
    score = await aggregate.simulation_score(session, simulation, scenario)
    # 백분위 비교값은 완주 스냅샷이 있으면 그것을 사용 — 모수(과거 스냅샷들)와 동일 기준
    snapshot = (simulation.state.get("score") or {}).get("total")
    percentile = await aggregate.scenario_percentile(
        session, scenario.id, snapshot if snapshot is not None else score["total"],
        exclude_simulation_id=simulation.id,
    )
    return {**score, "percentile": percentile}


@router.websocket("/ws/simulations/{simulation_id}")
async def simulation_ws(websocket: WebSocket, simulation_id: int, token: str | None = None):
    """NPC 자유 대화 + 선택지 제출 채널.

    인증: 쿼리스트링 ?token=<JWT> (WS는 헤더 불가). 없으면 데모 사용자. 원시 user_id는
    더 이상 받지 않는다 — 토큰 없이 임의 사용자 사칭이 가능했기 때문 (deps.resolve_user 공유).
    수신: {"type":"chat","npc":"김민지","content":"..."} | {"type":"choice","choice_id":"..."}
    송신: {"type":"session"...} → {"type":"token"...}* → {"type":"npc_reply"...}
          / {"type":"state_updated"...} / {"type":"step_changed"...} / {"type":"error"...}
    """
    await websocket.accept()
    try:
        async with SessionFactory() as session:
            user = await resolve_user(session, token=token)
            simulation, scenario = await service.get_owned_simulation(
                session, simulation_id, user
            )
            await websocket.send_json(
                {"type": "session", **_jsonable(await service.to_out(session, simulation, scenario))}
            )

        while True:
            data = await websocket.receive_json()
            async with SessionFactory() as session:
                simulation, scenario = await service.get_owned_simulation(
                    session, simulation_id, user
                )
                try:
                    if data.get("type") == "chat":
                        async for kind, payload in service.stream_npc_chat(
                            session, simulation, scenario, data.get("npc", ""), data.get("content", "")
                        ):
                            if kind == "token":
                                await websocket.send_json({"type": "token", "text": payload})
                            elif kind == "coach_tip":
                                await websocket.send_json({"type": "coach_tip", "text": payload["text"]})
                            else:
                                step_changed = payload.pop("step_changed")
                                await websocket.send_json({"type": "npc_reply", **payload})
                                if step_changed:
                                    await websocket.send_json(
                                        {"type": "step_changed", "step": step_changed}
                                    )
                    elif data.get("type") == "task_submit":
                        result = await service.submit_task(
                            session, simulation, scenario, data.get("content", "")
                        )
                        step_changed = result.pop("step_changed")
                        completed = result.pop("completed")
                        quest_fired = result.pop("sudden_quest")
                        is_quest = result.pop("is_quest")
                        coach_cards = result.pop("coach", None)
                        if is_quest:
                            # 단일 프레임 계약: quest_status가 passed/failed면 퀘스트 종료·본편 복귀
                            await websocket.send_json({"type": "quest_result", **result})
                        else:
                            await websocket.send_json({"type": "task_result", **result})
                            if step_changed:
                                await websocket.send_json(
                                    {"type": "step_changed", "step": step_changed}
                                )
                            if quest_fired:
                                await websocket.send_json(
                                    {"type": "sudden_quest", **quest_fired}
                                )
                            if completed:
                                await websocket.send_json({"type": "simulation_completed"})
                        if coach_cards:
                            # AI 코치 사후 리뷰 — 통과한 제출물에 대해 완료당 1회
                            await websocket.send_json({"type": "coach_cards", **coach_cards})
                    elif data.get("type") == "choice":
                        result = await service.submit_choice(
                            session, simulation, scenario, data.get("choice_id", "")
                        )
                        step_changed = result.pop("step_changed")
                        await websocket.send_json({"type": "state_updated", **result})
                        if step_changed:
                            await websocket.send_json(
                                {"type": "step_changed", "step": step_changed}
                            )
                    else:
                        await websocket.send_json(
                            {"type": "error", "detail": f"알 수 없는 타입: {data.get('type')}"}
                        )
                except HTTPException as e:
                    await websocket.send_json({"type": "error", "detail": e.detail})
    except WebSocketDisconnect:
        pass
    except HTTPException as e:
        await websocket.send_json({"type": "error", "detail": e.detail})
        await websocket.close()
    except Exception:  # noqa: BLE001
        logger.exception("WS 처리 중 오류 (simulation=%d)", simulation_id)
        await websocket.close(code=1011)


def _jsonable(out: dict) -> dict:
    out = dict(out)
    out["created_at"] = out["created_at"].isoformat()
    return out
