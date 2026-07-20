"""State Machine — 시나리오 스텝·상태값 유틸 (순수 함수).

스텝 전진은 과제 통과(task.on_pass)로만 일어난다 (게임 설계 확정 2026-07-20).
상태값 임계 전이(transitions/when)는 쓰지 않기로 해 관련 함수는 제거했다 —
대화·선택의 delta는 apply_deltas로 상태값만 누적하고 스텝은 바꾸지 않는다.
"""

import re

from app.core.config import settings

STATE_MIN, STATE_MAX = 0, 100


def find_step(steps: list[dict], step_id: str) -> dict:
    for step in steps:
        if step["id"] == step_id:
            return step
    raise ValueError(f"존재하지 않는 스텝: {step_id!r}")


def apply_deltas(state: dict, deltas: dict) -> dict:
    """상태값에 delta 적용 (0~100 클램프). step 등 숫자 아닌 키는 무시."""
    new_state = dict(state)
    for key, delta in deltas.items():
        if key in new_state and isinstance(new_state[key], (int, float)):
            new_state[key] = max(STATE_MIN, min(STATE_MAX, new_state[key] + delta))
    return new_state


END = "__end__"  # task.on_pass 특수값 — 시뮬레이션 완료


def public_task(task: dict) -> dict:
    """클라이언트에 보낼 과제 정보. 본편·퀘스트 공용.

    정답(answer)·정답 해설(answer_guide)은 settings.expose_answers=true일 때만 실린다
    (기본 차단). 정답이 클라이언트에 있으면 NPC 대화로 정보를 얻을 이유가 사라져 게임이
    성립하지 않는다 — 미달 시의 단계별 도움은 힌트 카드(hints.advice_card)가 담당한다.
    """
    out = {
        "kind": task.get("kind", "write"),
        "prompt": task["prompt"],
        "criteria": task["criteria"],  # 평가 기준 공개 = 미션 체크리스트 역할
        "pass_score": task.get("pass_score", 70),
    }
    if task.get("options"):  # 선택·배열형 보기 (표시 순서는 빌드 시 결정적 셔플)
        out["options"] = [{"key": o["key"], "label": o["label"]} for o in task["options"]]
    if settings.expose_answers:  # 개발 편의 — 시연·운영에서는 false
        if task.get("answer"):
            out["answer"] = task["answer"]
        if (task.get("hints") or {}).get("answer_guide"):
            out["answer_guide"] = task["hints"]["answer_guide"]
    return out


_STEP_MARKS = re.compile(r"\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*")


def briefing_steps(step: dict) -> list[str]:
    """사수가 업무 시작 전에 알려주는 '업무 절차' — 콘텐츠의 action_steps(①②③…)를 항목별로.

    과제 정답 키(answer)와는 다르다. 절차는 말로 알려주고(들어야 일을 할 수 있다),
    보기는 섞여서 내려가므로 들은 절차를 보기와 직접 매칭하는 건 사용자 몫이다.
    """
    guide = ((step.get("task") or {}).get("hints") or {}).get("answer_guide")
    if not guide:
        return []
    return [part.strip(" ,.·") for part in _STEP_MARKS.split(guide) if part.strip(" ,.·")]


def public_step(step: dict) -> dict:
    """클라이언트에 보낼 스텝 정보 — 선택지의 effects(정답 힌트)는 숨김."""
    task = step.get("task")
    return {
        "id": step["id"],
        "title": step["title"],
        "mission": step["mission"],
        "npcs": step.get("npcs", []),
        "guide": step.get("guide"),
        # 사수 브리핑 — 업무 시작 전에 절차를 알려준다(1·3단계 '대화로 익힘'의 재료)
        "briefing": briefing_steps(step),
        "choices": [
            {"id": c["id"], "text": c["text"]} for c in step.get("choices", [])
        ],
        "task": public_task(task) if task else None,
    }
