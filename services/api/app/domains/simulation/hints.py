"""힌트 3단계 (조언 카드) — 순수 함수. 항목별(불릿)로만 출력.

시도가 거듭될수록 힌트가 진해진다 (팀 결정):
  스텝 시작       → step.guide (가벼운 방향, 프론트가 기본 카드로 표시)
  1차 미달 (lv 1) → 가장 부족한 기준 1개 + 흔한 실수 경고
  2차 미달 (lv 2) → 미충족 기준 전부 + 채점 피드백
  3차 미달 (lv 3) → 정답 골격 공개 (필수 행동순서·요구 항목)
문장형 조언은 AI 코치(대화 중 TIP)가 담당하고, 힌트카드는 항목만 나열한다.
"""

import re


def _items(*lines: str) -> str:
    """빈 값 제외하고 '• 항목' 불릿 목록으로."""
    return "\n".join(f"• {ln}" for ln in lines if ln)


def advice_card(task: dict, attempt: int, scores: list[dict], feedback: str) -> dict:
    """미달 제출 직후의 조언 카드. attempt = 방금 실패한 제출이 몇 번째인지(1부터). 항목별 출력."""
    threshold = task.get("pass_score", 70)
    weak = sorted(
        (
            s
            for s in scores
            if isinstance(s.get("score"), (int, float)) and s["score"] < threshold
        ),
        key=lambda s: s["score"],
    )
    task_hints = task.get("hints") or {}

    if attempt <= 1:
        items = []
        if weak:
            items.append(f"가장 부족한 부분: {weak[0].get('criterion', '평가 기준')}")
        if task_hints.get("warning"):
            items.append(f"흔한 실수: {task_hints['warning']}")
        if not items:
            items.append(feedback or "평가 기준을 다시 읽고 빠진 항목이 없는지 확인해보세요.")
        return {"level": 1, "title": "조언 카드 — 방향 힌트", "content": _items(*items)}

    if attempt == 2:
        items = [f"{s.get('criterion', '평가 기준')}: {s.get('comment', '보완 필요')}" for s in weak]
        if feedback:
            items.append(f"총평: {feedback}")
        if not items:
            items.append("각 평가 기준을 제출물에 명시적으로 대응시켜 다시 작성해보세요.")
        return {"level": 2, "title": "조언 카드 — 보완할 항목", "content": _items(*items)}

    # 3차 이상 — 정답 골격 공개 (항목별)
    answer = task_hints.get("answer_guide")
    if answer:
        parts = [p.strip(" ,.·") for p in re.split(r"\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*", answer) if p.strip(" ,.·")]
        body = _items(*parts) if len(parts) > 1 else _items(answer)
    else:
        body = _items(*(f"{c}" for c in task.get("criteria", [])))
    return {"level": 3, "title": "조언 카드 — 정답 가이드", "content": body}


def should_fire_quest(next_step: dict, quest_status: str, roll: float) -> bool:
    """스텝 전환 시 돌발 퀘스트 발동 판정.

    - 확률 50%로 발동하되, **종착 스텝(과제의 on_pass가 __end__) 진입**이 마지막
      기회이므로 그 시점까지 미발동이면 강제 발동 — 스텝 배열 순서에 의존하지 않음
    - roll: 0~1 난수 (호출부에서 주입 — 테스트 가능하게)
    """
    if quest_status != "pending":
        return False
    next_task = next_step.get("task") or {}
    is_last_chance = next_task.get("on_pass") == "__end__"
    return is_last_chance or roll < 0.5
