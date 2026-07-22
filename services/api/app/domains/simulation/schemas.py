from datetime import datetime

from pydantic import BaseModel


class SimulationCreate(BaseModel):
    scenario_slug: str
    # 1:1 상담에서 '체험하기'로 진입할 때 실어보낸다 — 완주 리포트를 그 상담에 붙이기 위함.
    # 서버가 소유권을 검증해 저장하므로, 재개해도 DB에서 복원된다. 상담 없이 들어오면 생략.
    consultation_id: int | None = None


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
    spawn: str | None = None  # 맵 geometry.spawns의 자리 id(teamjang|sasu|bujang|npc4|npc5) — NPC를 그릴 위치


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
    briefing: list[str] = []  # 사수가 알려주는 업무 절차 (업무 시작 전 브리핑 + 업무 노트)
    choices: list[dict] = []
    task: TaskOut | None = None


class SimulationOut(BaseModel):
    id: int
    consultation_id: int | None = None  # 이 체험을 시작한 상담 — 재개 시 리포트 연동 복원용
    scenario_slug: str
    scenario_title: str
    module: str | None = None
    status: str
    state: dict
    step: StepOut
    step_ids: list[str] = []  # 본편 미션 id 순서 (진행률 계산용, 돌발 퀘스트 제외)
    npcs: list[NpcOut] = []  # 시나리오 NPC 표시정보 (npc_id → name/role/rank/spawn)
    map: GameMapOut | None = None  # null이면 맵 미배정 → module 배경 폴백
    # 4단계 미니게임 정의(data/minigames/<slug>.yaml) — null이면 프론트는 '준비 중' 폴백.
    # 엔진별로 data 구조가 달라 dict 그대로 통과시킨다(스키마로 좁히면 새 엔진마다 백엔드 수정 필요).
    minigame: dict | None = None
    created_at: datetime
