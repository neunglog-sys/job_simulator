"""사전 설문 (5지선다) — 자유대화 전 성향·기질 베이스라인 (2026-07-15 태수 설계).

콘텐츠는 data/counseling/survey.json (세종님 담당) — 파일만 교체하면 반영.
스코어링은 룰 기반(LLM 호출 없음): 선택지의 dimension_scores 합산 → 0~100 정규화.
완료 시 프로파일 요약을 consultation.summary에 저장 → 아바타가 알고 대화 시작.
"""

import json
from pathlib import Path

from fastapi import HTTPException

from app.core.config import settings


def _load() -> dict:
    path = Path(settings.data_dir) / "counseling" / "survey.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dimension_labels() -> dict[str, str]:
    """차원 키 → 한글 이름 (예: realistic → 현장·실행형). 추천 근거 문구 조립용."""
    return {key: dim["name"] for key, dim in _load()["dimensions"].items()}


def public_items() -> list[dict]:
    """클라이언트용 문항 — 선택지의 차원 점수(정답지)는 숨김."""
    return [
        {
            "id": item["id"],
            "text": item["text"],
            "options": [{"key": o["key"], "label": o["label"]} for o in item["options"]],
        }
        for item in _load()["items"]
    ]


def score_answers(answers: dict[str, str]) -> dict:
    """응답 → 차원별 0~100 프로파일. 문항 누락·잘못된 선택지는 400."""
    data = _load()
    items = {item["id"]: item for item in data["items"]}

    missing = set(items) - set(answers)
    if missing:
        raise HTTPException(status_code=400, detail=f"미응답 문항: {sorted(missing)}")

    totals: dict[str, float] = {}
    max_possible: dict[str, float] = {}
    for item_id, item in items.items():
        options = {o["key"]: o for o in item["options"]}
        choice = answers[item_id]
        if choice not in options:
            raise HTTPException(
                status_code=400, detail=f"{item_id}: 잘못된 선택지 '{choice}'"
            )
        for dim, score in options[choice].get("dimension_scores", {}).items():
            totals[dim] = totals.get(dim, 0) + score
        # 각 차원의 이론상 최대치 (문항별 해당 차원 최고 점수의 합)
        for dim in data["dimensions"]:
            best = max(
                (o.get("dimension_scores", {}).get(dim, 0) for o in item["options"]),
                default=0,
            )
            max_possible[dim] = max_possible.get(dim, 0) + best

    profile = {
        dim: round(totals.get(dim, 0) / max_possible[dim] * 100) if max_possible.get(dim) else 0
        for dim in data["dimensions"]
    }
    return profile


def profile_labels(profile: dict) -> list[str]:
    """상위 성향 2개의 라벨. 어미는 붙이지 않는다 — 문장 조립은 호출부 몫."""
    dims = _load()["dimensions"]
    top = sorted(profile.items(), key=lambda kv: kv[1], reverse=True)[:2]
    return [dims[d]["summary_label"] for d, v in top if d in dims and v > 0]


def profile_summary(profile: dict) -> str:
    """저장·프롬프트용 성향 요약 한 문장.

    ⚠️ 라벨이 전부 '…것을 선호'로 끝난다. 여기에 조사를 그대로 이어 붙이면
    '…선호이고, …선호인'처럼 비문이 된다(2026-07-28까지 사용자에게 그대로
    노출됐다). 연결·종결 어미를 붙여 문장으로 닫는다.
    """
    labels = profile_labels(profile)
    if not labels:
        return "아직 뚜렷한 성향이 드러나지 않았습니다"
    return "하고, ".join(labels) + "합니다"


def avatar_lines(profile: dict) -> list[str]:
    """설문 완료 → 자유대화 전환 대사 3종 (태수님 스크립트)."""
    labels = profile_labels(profile)
    if labels:
        opening = (
            f"지금까지 정리해보면 {'하고, '.join(labels)}하시는 것 같아요. "
            "제가 맞게 이해한 걸까요? 다르게 느끼는 부분이 있다면 알려주세요."
        )
    else:
        # 성향이 안 잡혔는데 억지로 요약을 끼우면 "…않음인 것 같아요"가 된다.
        opening = (
            "아직 성향이 뚜렷하게 드러나지는 않았어요. "
            "이야기를 나누면서 같이 찾아봐요."
        )
    return [
        opening,
        "이야기를 나눠보고 어울리는 직무를 찾으면, 먼저 체험해보고 싶은 걸 골라볼 수 있어요. "
        "실제로 해보면서 맞는지 확인해볼 수 있거든요.",
        "제가 정리한 내용 중에 와닿지 않는 부분이 있다면 편하게 말씀해주세요. 다시 조정해볼게요.",
    ]
