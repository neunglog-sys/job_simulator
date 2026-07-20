"""상담 첫 발화 지연 최적화 — RAG 가드 (짧은 발화 생략 · 임베딩 타임아웃 폴백).

RAG는 스트리밍 시작 전 직렬 구간(실측 ~1.2s)이라, 검색이 무의미한 발화는 왕복을
생략하고 임베딩 지연 스파이크에는 지식 없이 진행한다. 상담 품질의 폴백 원칙:
지식 주입 실패가 상담 자체를 막으면 안 된다.
"""

import asyncio

import pytest

from app.content import knowledge
from app.domains.consultation import service


def test_short_utterance_skips_rag(monkeypatch):
    called = False

    async def fake_search(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(service, "search_knowledge", fake_search)
    # "네", "고마워요" 류 — 임베딩 왕복 자체를 생략
    assert asyncio.run(service._fetch_knowledge(None, "네")) is None
    assert asyncio.run(service._fetch_knowledge(None, "  고마워요  ")) is None
    assert called is False
    # 실질 질문은 검색 수행
    asyncio.run(service._fetch_knowledge(None, "백엔드 개발자가 되려면 뭘 준비해야 하나요?"))
    assert called is True


def test_embed_timeout_falls_back_to_no_knowledge(monkeypatch):
    async def timing_out(*args, **kwargs):
        raise asyncio.TimeoutError

    monkeypatch.setattr(service, "search_knowledge", timing_out)
    assert asyncio.run(service._fetch_knowledge(None, "충분히 긴 직무 관련 질문입니다")) is None


def test_knowledge_joined_with_sources(monkeypatch):
    class _Chunk:
        source = "job.md"
        content = "직무 지식 내용"

    async def fake_search(*args, **kwargs):
        return [_Chunk(), _Chunk()]

    monkeypatch.setattr(service, "search_knowledge", fake_search)
    out = asyncio.run(service._fetch_knowledge(None, "충분히 긴 직무 관련 질문입니다"))
    assert out.count("[job.md]") == 2


def test_search_knowledge_embed_timeout_applies(monkeypatch):
    """embed_timeout은 임베딩 API 호출에 실제로 걸린다 (DB 단계 전이라 취소 안전)."""

    class _SlowLLM:
        async def embed(self, *args, **kwargs):
            await asyncio.sleep(5)

    monkeypatch.setattr(knowledge, "get_llm", lambda: _SlowLLM())
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(knowledge.search_knowledge(None, "질문", embed_timeout=0.02))
