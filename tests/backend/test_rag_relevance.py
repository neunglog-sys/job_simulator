"""RAG 관련도 컷오프(RAG_MAX_DISTANCE) 회귀 가드.

실측(0722, doc_chunks 25건)으로 0.4 → 0.35 조정: 오프토픽 커리어질문(포트폴리오·자소서 등)이
0.4 컷에서는 4/8 케이스가 통과하는 오탐이 있었다(거리 0.3668~0.3799). 이 테스트는 그 실측
오탐 구간(0.37)을 임베딩 벡터로 재현해, 컷이 다시 느슨해지면(예: 0.4로 되돌리면) 실패하도록
고정한다. 실제 임베딩 API는 호출하지 않는다 — get_llm().embed를 좌표를 직접 제어한 벡터로
대체해 코사인 거리를 정확히 0.30/0.37로 만든다.
"""

import math

import pytest

from app.content.knowledge import search_knowledge
from app.domains.consultation.service import RAG_MAX_DISTANCE as CONSULTATION_MAX_DISTANCE
from app.domains.simulation.service import RAG_MAX_DISTANCE as SIMULATION_MAX_DISTANCE
from app.models import DocChunk

DIM = 1536


def _unit_vector(cos_with_e0: float) -> list[float]:
    """e0(=[1,0,0,...])와 코사인 유사도가 cos_with_e0인 단위벡터."""
    v = [0.0] * DIM
    v[0] = cos_with_e0
    v[1] = math.sqrt(1 - cos_with_e0**2)
    return v


class _FakeLLM:
    def __init__(self, qvec: list[float]) -> None:
        self._qvec = qvec

    async def embed(self, *_args, **_kwargs):
        return [self._qvec]


@pytest.mark.asyncio(loop_scope="session")
async def test_off_topic_false_positive_band_stays_blocked(db_session, monkeypatch):
    query_vec = _unit_vector(1.0)  # 질의 자신 = e0

    relevant = DocChunk(
        job_code="test-relevant",
        source="test",
        content="관련 청크",
        embedding=_unit_vector(0.70),  # 코사인거리 0.30 — 명확히 관련
    )
    off_topic = DocChunk(
        job_code="test-off-topic",
        source="test",
        content="오프토픽 청크",
        embedding=_unit_vector(0.63),  # 코사인거리 0.37 — 실측 오탐대(0.3668~0.3799) 재현
    )
    db_session.add_all([relevant, off_topic])
    await db_session.flush()

    from app.content import knowledge

    monkeypatch.setattr(knowledge, "get_llm", lambda: _FakeLLM(query_vec))

    chunks = await search_knowledge(
        db_session, "쿼리", top_k=5, max_distance=CONSULTATION_MAX_DISTANCE
    )
    got = {c.job_code for c in chunks}
    assert "test-relevant" in got, "명확히 관련된 청크(거리 0.30)가 유실됨"
    assert "test-off-topic" not in got, (
        "실측 오탐대(거리 0.37) 청크가 통과함 — RAG_MAX_DISTANCE가 0.35보다 느슨해졌는지 확인"
    )


def test_consultation_and_simulation_thresholds_in_sync():
    """두 도메인에 중복 정의된 RAG_MAX_DISTANCE — 한쪽만 튜닝하고 잊는 걸 방지."""
    assert CONSULTATION_MAX_DISTANCE == SIMULATION_MAX_DISTANCE
