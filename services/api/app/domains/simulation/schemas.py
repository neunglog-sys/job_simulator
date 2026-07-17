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
    # 정답·정답 해설 — settings.expose_answers=true(개발 편의)일 때만 값이 실린다. 기본은 null.
    # 미달 시의 단계별 도움은 힌트 카드(task_result.advice_card)가 담당한다.
    answer: dict | None = None
    answer_guide: str | None = None


class NpcOut(BaseModel):
    npc_id: str
    name: str
    role: str
    rank: str | None = None
    spawn: str | None = None  # 맵 geometry.spawns의 자리 id(teamjang|sasu|bujang) — NPC를 그릴 위치


class GameMapOut(BaseModel):
    """게임 맵 — 프론트가 배경을 깔고 geometry(walkable·collision·spawns)로 이동 판정."""

    id: str
    background: str | None = None  # /maps/<폴더>/<파일>.png (백엔드 정적 서빙)
    geometry: dict


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
    step_ids: list[str] = []  # 본편 미션 id 순서 (진행률 계산용, 돌발 퀘스트 제외)
    npcs: list[NpcOut] = []  # 시나리오 NPC 표시정보 (npc_id → name/role/rank/spawn)
    map: GameMapOut | None = None  # null이면 맵 미배정 → module 배경 폴백
    created_at: datetime
