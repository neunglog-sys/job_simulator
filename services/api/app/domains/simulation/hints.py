"""힌트 3단계 (AI 조언 카드) — 순수 함수.

시도가 거듭될수록 힌트가 진해진다 (팀 결정):
  스텝 시작       → step.guide (가벼운 방향, 프론트가 기본 카드로 표시)
  1차 미달 (lv 1) → 가장 부족한 평가 기준 1개 + 흔한 실수 경고
  2차 미달 (lv 2) → 미충족 기준 전부 + 채점 피드백
  3차 미달 (lv 3) → 정답 골격 공개 (필수 행동순서·요구 항목)
정답을 봐도 직접 작성·제출해서 pass_score를 넘어야 통과한다.
"""


def advice_card(task: dict, attempt: int, scores: list[dict], feedback: str) -> dict:
    """미달 제출 직후의 조언 카드. attempt = 방금 실패한 제출이 몇 번째인지(1부터)."""
    threshold = task.get("pass_score", 70)  # "부족한 기준" 판정도 통과선과 동일 기준
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
        content = []
        if weak:
            top = weak[0]
            content.append(f"가장 부족한 부분: {top.get('criterion', '평가 기준')}")
            if top.get("comment"):
                content.append(top["comment"])
        if task_hints.get("warning"):
            content.append(f"⚠️ 흔한 실수: {task_hints['warning']}")
        if not content:
            content.append(feedback or "평가 기준을 다시 읽고 빠진 항목이 없는지 확인해보세요.")
        return {"level": 1, "title": "조언 카드 — 방향 힌트", "content": "\n".join(content)}

    if attempt == 2:
        lines = [
            f"• {s.get('criterion', '평가 기준')}: {s.get('comment', '보완 필요')}" for s in weak
        ]
        if feedback:
            lines.append(f"총평: {feedback}")
        if not lines:  # 기준별 점수가 없으면 피드백이라도 (빈 카드 방지)
            lines.append("각 평가 기준을 제출물에 명시적으로 대응시켜 다시 작성해보세요.")
        return {"level": 2, "title": "조언 카드 — 보완할 항목", "content": "\n".join(lines)}

    # 3차 이상 — 정답 골격 공개
    answer = task_hints.get("answer_guide")
    if not answer:
        answer = "제출물에 다음 항목을 모두 명시적으로 포함하세요:\n" + "\n".join(
            f"{i}. {c}" for i, c in enumerate(task.get("criteria", []), 1)
        )
    return {
        "level": 3,
        "title": "조언 카드 — 정답 가이드",
        "content": answer + "\n\n이 가이드대로 직접 작성해 다시 제출하면 통과할 수 있어요.",
    }


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
