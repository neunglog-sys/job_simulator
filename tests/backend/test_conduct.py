"""대화 태도(사회생활 화법) 집계 — state['affinity'] → 리포트용 conduct 신호.

역량 5종(팀 확정 공식)에는 넣지 않는다. 태도는 직무 역량이 아니라 '함께 일하는 방식'이라
리포트가 관찰 소견으로만 인용한다.
"""

from app.domains.scoring.aggregate import conduct_from_affinity


def test_none_when_no_conversation():
    # 아무와도 대화 안 함 → 근거 없음 (리포트에서 생략돼야 함)
    assert conduct_from_affinity({}) is None
    assert conduct_from_affinity({"affinity": {}}) is None
    assert conduct_from_affinity({"trust": 50}) is None  # 시나리오 상태값은 태도가 아님


def test_average_and_band():
    c = conduct_from_affinity({"affinity": {"a": 80, "b": 60}})
    assert c["average"] == 70 and c["band"] == "높음" and c["npc_count"] == 2


def test_bands():
    assert conduct_from_affinity({"affinity": {"a": 30}})["band"] == "낮음"
    assert conduct_from_affinity({"affinity": {"a": 50}})["band"] == "보통"
    assert conduct_from_affinity({"affinity": {"a": 70}})["band"] == "높음"


def test_lowest_surfaces_rudeness_to_one_npc():
    # 한 명에게만 무례했어도 평균에 묻히지 않아야 한다 (리포트가 짚을 수 있게)
    c = conduct_from_affinity({"affinity": {"a": 90, "b": 90, "c": 10}})
    assert c["average"] == 63  # 평균만 보면 '보통'
    assert c["lowest"] == 10  # 최저값이 드러남


def test_ignores_non_numeric_and_bool():
    c = conduct_from_affinity({"affinity": {"a": 60, "b": None, "c": True, "d": "x"}})
    assert c["npc_count"] == 1 and c["average"] == 60
