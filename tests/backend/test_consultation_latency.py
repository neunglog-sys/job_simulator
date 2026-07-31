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


def test_rag_task_cancelled_when_prep_fails(monkeypatch):
    """조인 전(commit 등) 예외 시, 먼저 띄운 RAG 태스크가 고아로 남지 않고 취소돼야 한다.

    회귀 방지: 병렬화하며 knowledge_task를 만들어놓고 await 전에 예외가 나면
    별도 세션 커넥션을 붙잡은 채 남는 누수가 있었다(finally 취소 누락).
    """
    cancelled = asyncio.Event()

    # _fetch_knowledge_isolated(user_text, consultation_id) — 스코프 인자 추가분까지 받는다
    async def slow_rag(_user_text, _consultation_id=None):
        try:
            await asyncio.sleep(5)  # await knowledge_task 전에 실패가 나면 취소돼야 함
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return None

    monkeypatch.setattr(service, "_fetch_knowledge_isolated", slow_rag)

    class _FailingSession:
        def add(self, _obj):
            pass

        async def commit(self):
            # 먼저 한 번 양보해 RAG 태스크가 실제로 떠서 세션을 열게 한 뒤 실패시킨다 —
            # 태스크가 시작도 안 한 상태면 애초에 열린 커넥션이 없어 누수 케이스가 아니다.
            await asyncio.sleep(0)
            raise RuntimeError("commit 실패 — 조인 전 예외 재현")

    class _Consultation:
        id = 1

    async def run():
        gen = service.stream_reply(_FailingSession(), _Consultation(), "충분히 긴 상담 발화입니다")
        with pytest.raises(RuntimeError):
            await gen.__anext__()
        # cancel()은 다음 루프 사이클에 전달 — 취소가 태스크에 도달할 때까지 대기
        await asyncio.wait_for(cancelled.wait(), timeout=1.0)

    asyncio.run(run())
    assert cancelled.is_set()


def test_embed_timeout_falls_back_to_no_knowledge(monkeypatch):
    async def timing_out(*args, **kwargs):
        raise asyncio.TimeoutError

    monkeypatch.setattr(service, "search_knowledge", timing_out)
    assert asyncio.run(service._fetch_knowledge(None, "충분히 긴 직무 관련 질문입니다")) is None


def test_knowledge_joined_with_sources(monkeypatch):
    class _Chunk:
        source = "job.md"
        content = "직무 지식 내용"
        job_code = "backend-developer"  # scope_chunks가 .job_code로 지배 직무 판정

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


def test_greeting_clip_url_reflects_file_presence(tmp_path, monkeypatch):
    """인사 클립 계약 — 파일이 있으면 URL, 없으면 None (기존 흐름 폴백)."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    assert service.greeting_clip_url() is None
    clip_dir = tmp_path / "avatar-clips"
    clip_dir.mkdir()
    (clip_dir / "greeting.mp4").write_bytes(b"\x00")
    assert service.greeting_clip_url() == "/avatar-clips/greeting.mp4"
