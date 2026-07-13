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


def profile_summary(profile: dict) -> str:
    """상위 성향 2개로 [요약 내용] 문장 조립 — 아바타 summary·전환 대사 공용."""
    dims = _load()["dimensions"]
    top = sorted(profile.items(), key=lambda kv: kv[1], reverse=True)[:2]
    labels = [dims[d]["summary_label"] for d, v in top if d in dims and v > 0]
    if not labels:
        return "아직 뚜렷한 성향이 드러나지 않음"
    return "이고, ".join(labels)


def avatar_lines(profile: dict) -> list[str]:
    """설문 완료 → 자유대화 전환 대사 3종 (태수님 스크립트)."""
    summary = profile_summary(profile)
    return [
        f"지금까지 정리해보면 {summary}인 것 같아요. 제가 맞게 이해한 걸까요? "
        "다르게 느끼는 부분이 있다면 알려주세요.",
        "이야기를 나눠보고 어울리는 직무를 찾으면, 먼저 체험해보고 싶은 걸 골라볼 수 있어요. "
        "실제로 해보면서 맞는지 확인해볼 수 있거든요.",
        "제가 정리한 내용 중에 와닿지 않는 부분이 있다면 편하게 말씀해주세요. 다시 조정해볼게요.",
    ]
