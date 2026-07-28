"""일상·엣지 골든셋 무결성 — 스키마·구성비·게이트 스탬프 일치.

이 셋은 손으로 검수해 고정하는 자산이라, 실수로 항목이 빠지거나 게이트 코드가 바뀌어
expected_gate 스탬프가 낡으면 지표 추세가 조용히 끊긴다. 여기서 잡는다.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

from app.domains.consultation import rag_gate

GOLDEN = Path(__file__).resolve().parents[2] / "data" / "evaluation" / "golden"

DAILY = json.loads((GOLDEN / "daily_60.json").read_text(encoding="utf-8"))
EDGE = json.loads((GOLDEN / "edge_30.json").read_text(encoding="utf-8"))

REQUIRED = {"id", "q", "subtype", "source", "origin_id", "expected_gate", "gate_reason",
            "pass_criteria", "fail_criteria"}


@pytest.mark.parametrize("doc, n", [(DAILY, 60), (EDGE, 30)], ids=["daily", "edge"])
def test_schema_and_count(doc, n):
    items = doc["items"]
    assert len(items) == n
    ids = [i["id"] for i in items]
    assert len(set(ids)) == n, "id 중복"
    for it in items:
        assert REQUIRED <= set(it), f"{it['id']} 필드 누락: {REQUIRED - set(it)}"
        assert it["q"].strip(), f"{it['id']} 빈 질문"
        assert it["source"] in ("real", "real_edited", "synthetic")
        # real/real_edited는 출처 발화 해시가 있어야 하고, synthetic은 없어야 한다
        assert (it["origin_id"] is not None) == (it["source"] != "synthetic"), it["id"]
        assert it["pass_criteria"] and it["fail_criteria"], f"{it['id']} 판정 기준 누락"


def test_daily_composition():
    c = Counter(i["subtype"] for i in DAILY["items"])
    assert c == {"greeting": 12, "reaction": 8, "smalltalk": 12, "career_general": 28}
    # 일상 파트는 전부 실발화 — 합성이 섞이면 '실사용 회귀셋'이라는 전제가 깨진다
    assert all(i["source"] == "real" for i in DAILY["items"])


def test_edge_composition():
    c = Counter(i["subtype"] for i in EDGE["items"])
    assert set(c.values()) == {3} and len(c) == 10, c


@pytest.mark.parametrize(
    "item",
    DAILY["items"] + EDGE["items"],
    ids=[i["id"] for i in DAILY["items"] + EDGE["items"]],
)
def test_gate_stamp_current(item):
    """expected_gate가 현재 게이트 코드와 일치 — 게이트를 바꿨다면 스탬프도 재생성할 것.

    갱신법: scripts 없이도 rag_gate.rag_decision(q)를 돌려 expected_gate/gate_reason만
    다시 쓰면 된다(세션 스크래치패드 stamp_gate.py 참조). 이 테스트가 깨진 채 머지하면
    골든셋 게이트 회귀 지표가 낡은 기준으로 측정된다.
    """
    run, reason = rag_gate.rag_decision(item["q"].strip())
    assert ("run" if run else "skip") == item["expected_gate"], item["id"]
    assert reason == item["gate_reason"], item["id"]
