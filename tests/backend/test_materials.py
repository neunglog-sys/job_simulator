"""스텝 제공자료(data/materials) — 로더와 세트 선택.

시나리오의 guide는 자료 '이름'만 나열한다. 플레이어가 실제로 대조해 답을 찾을 수 있도록
자료 본문을 별도 원본으로 두고, 시뮬레이션마다 세트를 하나 골라 고정해 보여준다.
"""

import pytest

from app.content import materials


@pytest.fixture(autouse=True)
def _clear():
    materials.clear_caches()
    yield
    materials.clear_caches()


def test_kts03_m4_has_multiple_sets():
    """정산 차액 스텝엔 세트가 여러 개 있어야 한다 — 하나뿐이면 정답을 외워서 풀 수 있다."""
    sets = materials.material_sets_for("kts-03", "m4")
    assert len(sets) >= 2
    assert materials.steps_with_materials("kts-03") == ["m4"]


def test_every_set_has_documents_and_distinct_cause():
    """세트마다 문서가 있고, 차액 원인은 서로 달라야 세트를 바꾼 의미가 있다."""
    sets = materials.material_sets_for("kts-03", "m4")
    causes = set()
    for entry in sets:
        assert entry["documents"], f"{entry['id']}: 문서 없음"
        assert entry.get("cause"), f"{entry['id']}: 차액 원인 없음"
        for doc in entry["documents"]:
            assert doc.get("title") and doc.get("body"), f"{entry['id']}: 제목·본문 누락"
        causes.add(entry["cause"])
    assert len(causes) == len(sets), "세트끼리 차액 원인이 겹친다"


def test_public_documents_hides_answer():
    """클라이언트로는 문서만 나간다 — 정답(cause)이 섞여 나가면 답이 그대로 보인다."""
    entry = materials.material_sets_for("kts-03", "m4")[0]
    public = materials.public_documents(entry)
    assert [d["title"] for d in public] == [d["title"] for d in entry["documents"]]
    assert all(set(d.keys()) == {"title", "body"} for d in public)
    assert entry["cause"] not in str(public)


def test_missing_scenario_returns_empty():
    """자료가 없는 시나리오는 빈 값 — 자료 없이도 게임이 돌아가야 한다."""
    assert materials.material_sets_for("no-such-scenario", "m1") == []
    assert materials.steps_with_materials("no-such-scenario") == []
    assert materials.material_sets_for("kts-03", "m1") == []
