import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionFactory, get_session
from app.core.deps import DEMO_EMAIL, get_current_user
from app.domains.simulation import service
from app.domains.simulation.schemas import SimulationCreate, SimulationOut
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["simulation"])


@router.post("/api/simulations", response_model=SimulationOut, status_code=201)
async def create_simulation(
    body: SimulationCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.create_simulation(session, user, body.scenario_slug)
    return service.to_out(simulation, scenario)


@router.get("/api/simulations/{simulation_id}", response_model=SimulationOut)
async def get_simulation(
    simulation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.get_owned_simulation(session, simulation_id, user)
    return service.to_out(simulation, scenario)


@router.post("/api/simulations/{simulation_id}/finish", response_model=SimulationOut)
async def finish_simulation(
    simulation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    simulation, scenario = await service.get_owned_simulation(session, simulation_id, user)
    simulation = await service.finish_simulation(session, simulation)
    return service.to_out(simulation, scenario)


async def _ws_user(session: AsyncSession, user_id: int | None) -> User:
    """WS용 사용자 조회 — 쿼리 파라미터 user_id, 없으면 데모 사용자 (deps와 동일 정책)."""
    if user_id is not None:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="존재하지 않는 사용자")
        return user
    user = (
        await session.execute(select(User).where(User.email == DEMO_EMAIL))
    ).scalar_one_or_none()
    if user is None:
        user = User(email=DEMO_EMAIL, name="데모 사용자")
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user


@router.websocket("/ws/simulations/{simulation_id}")
async def simulation_ws(websocket: WebSocket, simulation_id: int, user_id: int | None = None):
    """NPC 자유 대화 + 선택지 제출 채널.

    수신: {"type":"chat","npc":"김민지","content":"..."} | {"type":"choice","choice_id":"..."}
    송신: {"type":"session"...} → {"type":"token"...}* → {"type":"npc_reply"...}
          / {"type":"state_updated"...} / {"type":"step_changed"...} / {"type":"error"...}
    """
    await websocket.accept()
    try:
        async with SessionFactory() as session:
            user = await _ws_user(session, user_id)
            simulation, scenario = await service.get_owned_simulation(
                session, simulation_id, user
            )
            await websocket.send_json(
                {"type": "session", **_jsonable(service.to_out(simulation, scenario))}
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
                        await websocket.send_json({"type": "task_result", **result})
                        if step_changed:
                            await websocket.send_json(
                                {"type": "step_changed", "step": step_changed}
                            )
                        if completed:
                            await websocket.send_json({"type": "simulation_completed"})
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
