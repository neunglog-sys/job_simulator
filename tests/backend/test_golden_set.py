"""직무지식 골든셋 스키마 가드.

골든셋은 정답을 청크 1개가 아니라 '구별 불가능한 동등 청크 집합'으로 잡는다.
J 청크 515개(직무 103 × 단계 5) 중 490개(95.1%)가 같은 직무군 안에서 본문이
글자 단위로 같기 때문에, 정답 하나만 인정하면 똑같은 근거가 검색돼도 오답으로
세게 된다(실측: 그 오탐이 5건, 직무 오염 15.0% 중 12.5%p).

여기서는 API를 부르지 않고 파일 구조만 본다 — 실제 검색 성능은
app/scripts/eval_retrieval.py로 잰다.
"""

import json
from pathlib import Path

import pytest

from app.core.config import settings

GOLDEN_PATH = Path(settings.data_dir) / "evaluation" / "golden" / "job_knowledge_40.json"

FAMILY_KINDS = {"family_stage", "family_only"}
ALL_KINDS = {"exact_job", "wrong_job_hint", *FAMILY_KINDS, "chunk_missing"}


@pytest.fixture(scope="module")
def golden() -> list[dict]:
    if not GOLDEN_PATH.exists():
        pytest.skip(f"골든셋 없음: {GOLDEN_PATH}")
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_every_item_is_classified(golden):
    unknown = {g.get("kind") for g in golden} - ALL_KINDS
    assert not unknown, f"모르는 분류: {unknown}"


def test_no_orphan_items(golden):
    """chunk_text가 코퍼스에서 사라지면 그 문항은 채점에서 빠진다 — 조용히 줄어들면 안 된다."""
    orphans = [g["q"][:40] for g in golden if g.get("kind") == "chunk_missing"]
    assert not orphans, f"코퍼스에 없는 정답 청크를 가리키는 문항: {orphans}"


def test_ground_truth_is_inside_its_acceptable_set(golden):
    for g in golden:
        acceptable = g.get("acceptable_chunk_ids") or []
        assert acceptable, f"동등 청크 집합이 비었다: {g['q'][:40]}"
        assert g["gt_chunk_id"] in acceptable, (
            f"정답 청크가 자기 동등 집합에 없다: {g['q'][:40]}"
        )
        assert g["gt_job_code"] in (g.get("acceptable_job_codes") or [])


def test_exact_job_questions_name_the_job(golden):
    """exact_job은 '질문이 직무명을 콕 집었다'는 뜻 — 그래야 그 직무만 정답으로 볼 근거가 있다."""
    for g in golden:
        if g.get("kind") == "exact_job":
            assert g["gt_job_name"] in g["q"], f"직무명이 질문에 없다: {g['q'][:40]}"


def test_family_questions_do_not_name_the_job(golden):
    """직무명이 있는데 family로 분류되면 동등 청크를 과하게 인정하게 된다."""
    for g in golden:
        if g.get("kind") in FAMILY_KINDS:
            assert g["gt_job_name"] not in g["q"], (
                f"직무명이 들어 있는데 {g['kind']}로 분류됨: {g['q'][:40]}"
            )


def test_review_flagged_items_carry_the_conflicting_job(golden):
    """wrong_job_hint = 질문이 정답 아닌 다른 직무를 가리킨다. 어떤 직무인지 남아 있어야 검토가 된다."""
    for g in golden:
        if g.get("kind") == "wrong_job_hint":
            assert g.get("question_mentions_jobs"), f"충돌 직무 미기록: {g['q'][:40]}"


def test_stage_labels_are_the_known_five(golden):
    stages = {g.get("gt_stage") for g in golden}
    assert len(stages) <= 5, f"단계 라벨이 5개를 넘는다: {sorted(stages)}"
    assert None not in stages
