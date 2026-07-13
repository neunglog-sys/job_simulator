from datetime import datetime

from pydantic import BaseModel


class SimulationCreate(BaseModel):
    scenario_slug: str


class TaskOut(BaseModel):
    kind: str = "write"
    prompt: str
    criteria: list[str]
    pass_score: int
    options: list[dict] = []  # 선택·배열형 보기 (kind가 choice/checklist/order일 때)


class NpcOut(BaseModel):
    npc_id: str
    name: str
    role: str
    rank: str | None = None


class StepOut(BaseModel):
    id: str
    title: str
    mission: str
    npcs: list[str]  # npc_id 목록 (표시정보는 SimulationOut.npcs에서 조회)
    guide: str | None = None
    choices: list[dict] = []
    task: TaskOut | None = None


class SimulationOut(BaseModel):
    id: int
    scenario_slug: str
    scenario_title: str
    module: str | None = None
    status: str
    state: dict
    step: StepOut
    npcs: list[NpcOut] = []  # 시나리오 NPC 표시정보 (npc_id → name/role/rank)
    created_at: datetime
