"""스텝 제공자료(data/materials) — 로더와 세트 선택.

시나리오의 guide는 자료 '이름'만 나열한다. 플레이어가 실제로 대조해 답을 찾을 수 있도록
자료 본문을 별도 원본으로 두고, 시뮬레이션마다 세트를 하나 골라 고정해 보여준다.
"""

from pathlib import Path

import pytest

from app.content import materials


@pytest.fixture(autouse=True)
def _clear():
    materials.clear_caches()
    yield
    materials.clear_caches()


def test_sns01_m4_has_multiple_sets():
    """SNS 일일 보고도 서술형이라 자료가 필요하다 — 세트가 여러 개여야 정답을 못 외운다."""
    sets = materials.material_sets_for("sns-01", "m4")
    assert len(sets) >= 2
    assert materials.steps_with_materials("sns-01") == ["m4"]
    causes = {s["cause"] for s in sets}
    assert len(causes) == len(sets), "세트끼리 핵심 이슈가 겹친다"
    for entry in sets:
        assert entry["documents"], f"{entry['id']}: 문서 없음"
        for doc in entry["documents"]:
            assert doc.get("title") and doc.get("body"), f"{entry['id']}: 제목·본문 누락"


def test_kts03_covers_every_step_that_promises_materials():
    """guide가 '제공 자료: …'라고 적은 스텝엔 실제 자료가 있어야 한다.

    m4만 만들어 두고 m1~m3은 안내만 하던 시절이 있었다(2026-07-28 E2E에서 발견).
    플레이어는 없는 자료를 찾아 헤매게 되므로, 약속과 실물을 여기서 묶어 둔다.
    """
    promised = _steps_promising_materials("kts-03")
    have = set(materials.steps_with_materials("kts-03"))
    missing = sorted(promised - have)
    assert not missing, f"guide는 자료를 약속했는데 본문이 없는 스텝: {missing}"


@pytest.mark.parametrize("step_id", ["m1", "m2", "m3", "m4"])
def test_every_set_has_documents_and_distinct_cause(step_id):
    """세트마다 문서가 있고, 핵심 사실은 서로 달라야 세트를 바꾼 의미가 있다."""
    sets = materials.material_sets_for("kts-03", step_id)
    assert len(sets) >= 2, f"{step_id}: 세트가 하나뿐이면 정답을 외워서 풀 수 있다"
    causes = set()
    for entry in sets:
        assert entry["documents"], f"{entry['id']}: 문서 없음"
        assert entry.get("cause"), f"{entry['id']}: 핵심 사실 없음"
        for doc in entry["documents"]:
            assert doc.get("title") and doc.get("body"), f"{entry['id']}: 제목·본문 누락"
        causes.add(entry["cause"])
    assert len(causes) == len(sets), f"{step_id}: 세트끼리 핵심 사실이 겹친다"


def test_sns01_sets_carry_their_own_criteria():
    """세트마다 채점 기준이 따로 있어야 한다.

    시나리오 본문의 m4 기준은 링크 만료 사건에 맞춰져 있다("랜딩 링크 404 시각").
    다른 세트가 배정되면 자료에 없는 것을 요구받아 통과가 구조적으로 불가능해진다
    (2026-07-28 E2E에서 wrong-account 세트가 실제로 그렇게 막혔다).
    """
    for entry in materials.material_sets_for("sns-01", "m4"):
        criteria = entry.get("criteria") or []
        assert len(criteria) >= 3, f"{entry['id']}: 세트 채점 기준이 없거나 너무 적다"
        joined = " ".join(criteria)
        # 다른 세트의 사건을 요구하면 안 된다 — 그 자료엔 그 사실이 없다
        if entry["id"] != "link-broken":
            assert "404" not in joined, f"{entry['id']}: 링크 만료 세트의 기준이 새어 들어왔다"


def test_set_criteria_replace_scenario_criteria():
    """세트 기준이 있으면 시나리오 기준을 대체하고, 없으면 시나리오 기준을 유지한다."""
    from types import SimpleNamespace

    import yaml

    from app.core.config import settings
    from app.domains.simulation import service

    def _step(slug: str, step_id: str) -> dict:
        path = Path(settings.data_dir) / "scenarios" / f"{slug}.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return next(s for s in data["steps"] if s["id"] == step_id)

    # sns-01: 세트가 criteria를 들고 있으므로 시나리오의 404 기준은 빠져야 한다
    sns_step = _step("sns-01", "m4")
    assert any("404" in c for c in sns_step["task"]["criteria"]), "전제가 바뀌었다 — 테스트 갱신 필요"
    task = service._task_with_material_criteria(
        SimpleNamespace(slug="sns-01"), {"material_sets": {"m4": "wrong-account"}}, sns_step,
        sns_step["task"],
    )
    assert not any("404" in c for c in task["criteria"])
    assert any("계정 전환" in c for c in task["criteria"])

    # kts-03: 세트에 criteria가 없으므로 시나리오 기준이 그대로 남는다
    kts_step = _step("kts-03", "m4")
    kts_task = service._task_with_material_criteria(
        SimpleNamespace(slug="kts-03"), {"material_sets": {"m4": "float-missing"}}, kts_step,
        kts_step["task"],
    )
    for original in kts_step["task"]["criteria"]:
        assert original in kts_task["criteria"], "세트 기준이 없는데 시나리오 기준이 사라졌다"


def _steps_promising_materials(slug: str) -> set[str]:
    """시나리오 guide에 '제공 자료'라고 적힌 스텝 id."""
    import yaml

    from app.core.config import settings

    path = Path(settings.data_dir) / "scenarios" / f"{slug}.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {
        step["id"]
        for step in data.get("steps", [])
        if "제공 자료" in (step.get("guide") or "") or "제공자료" in (step.get("guide") or "")
    }


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
    # 자료를 약속하지 않은 스텝은 그대로 빈 값 — 자료 없이도 그 스텝이 돌아가야 한다
    assert materials.material_sets_for("kts-03", "m5") == []
