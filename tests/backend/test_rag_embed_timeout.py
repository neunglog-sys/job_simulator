"""RAG 임베딩 타임아웃 — 설정으로 뺐고, 기본값이 환경을 죽이지 않는지.

## 왜 이 테스트가 있나

2026-07-28 장애: 타임아웃을 2.0 → 1.0으로 낮춰 배포했더니 VM에서 **8/8 전건 초과**,
지식 주입률 0%가 됐다. 상담이 직무 지식 없이 답하고 있었는데 화면에는 아무 표시도
없었다(초과 시 조용히 지식 없이 진행하는 설계라 그렇다).

원인은 값 자체가 아니라 **값을 정한 방식**이다. 로컬 실측(p50 365ms · p90 409ms)으로
프로덕션 컷을 정했는데 VM은 그보다 느렸다. 그리고 하드코딩이라 서버에서 손댈 수도 없었다.

그래서 두 가지를 고정한다.
  ① 설정으로 읽어야 한다 — .env로 환경마다 맞출 수 있어야 코드 배포 없이 복구된다
  ② 호출 시점에 읽어야 한다 — import 시점에 상수로 굳으면 설정을 바꿔도 안 먹는다
"""

import asyncio

import pytest

from app.core.config import settings
from app.domains.consultation import service


def test_timeout_comes_from_settings():
    assert settings.rag_embed_timeout_s == service.RAG_EMBED_TIMEOUT_S


def test_default_restores_the_known_good_value():
    """1.0은 VM에서 전건 초과했다. 기본값은 그 이전의 동작하던 값이어야 한다."""
    default = type(settings).model_fields["rag_embed_timeout_s"].default
    assert default >= 2.0, (
        f"기본 타임아웃 {default}s — 1.0s에서 VM 전건 초과가 났다. 낮추려면 "
        "그 환경의 [RAG-EMBED] 분포를 근거로 .env에서 낮출 것"
    )


@pytest.mark.asyncio(loop_scope="session")
async def test_setting_change_takes_effect_without_reimport(monkeypatch):
    """설정을 바꾸면 그 호출부터 먹어야 한다 — 상수로 굳으면 .env 조정이 무의미해진다."""
    seen: list[float | None] = []

    async def fake_search(*_args, **kwargs):
        seen.append(kwargs.get("embed_timeout"))
        return []

    monkeypatch.setattr(service, "search_knowledge", fake_search)
    monkeypatch.setattr(service.rag_gate, "should_run_rag", lambda _t: True)
    monkeypatch.setattr(settings, "rag_embed_timeout_s", 7.5)

    await service._fetch_knowledge(None, "직무에 대해 자세히 알려주세요")

    assert seen and seen[0] == 7.5, (
        f"호출에 실린 타임아웃 {seen} — 설정 변경이 반영되지 않았다"
    )


@pytest.mark.asyncio(loop_scope="session")
async def test_timeout_is_swallowed_not_raised(monkeypatch):
    """초과해도 상담은 계속돼야 한다 — 지식 없이 답할지언정 대화가 끊기면 안 된다."""

    async def slow_search(*_args, **_kwargs):
        raise asyncio.TimeoutError

    monkeypatch.setattr(service, "search_knowledge", slow_search)
    monkeypatch.setattr(service.rag_gate, "should_run_rag", lambda _t: True)

    assert await service._fetch_knowledge(None, "직무에 대해 자세히 알려주세요") is None
