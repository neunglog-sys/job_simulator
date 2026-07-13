from datetime import datetime

from pydantic import BaseModel


class SimulationCreate(BaseModel):
    scenario_slug: str


class TaskOut(BaseModel):
    prompt: str
    criteria: list[str]
    pass_score: int


class StepOut(BaseModel):
    id: str
    title: str
    mission: str
    npcs: list[str]
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
    created_at: datetime
