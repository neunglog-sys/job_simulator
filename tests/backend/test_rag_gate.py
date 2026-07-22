"""RAG 선택적 스킵 게이트 — 순수 판정 함수 테이블 테스트.

왜 중요한가: 이 게이트가 '진짜 질문'을 오스킵하면 직무 지식 없이 답해 품질이 떨어진다.
기본값은 '실행'이어야 하고, 스킵은 확실한 잡담/짧은 발화에만 일어나야 한다.
"""

from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.domains.consultation import rag_gate


@pytest.mark.parametrize(
    "text, expected",
    [
        ("안녕하세요", False),               # 짧음·질문X·키워드X (인사)
        ("네 알겠습니다 감사해요", False),   # 전체 filler
        ("ㅋㅋㅋ", False),                   # 짧음(웃음)
        ("기획자 뭐야?", True),              # 질문(뭐) — 7자, 기존이면 스킵됐음
        ("기획자가 뭐야", True),             # 질문(뭐) 물음표 없이
        ("포트폴리오 어떻게 준비해요", True),# 질문(어떻게)
        ("자소서 막막해요", True),           # 커리어 키워드
        ("포트폴리오", True),                # 키워드 5자, 길이 override
        ("면접", True),                      # 키워드 2자, 길이 override
        ("그거 좀 더 알려줘", True),         # 기본(잡담 아님)
        ("저는 사람 만나는 걸 좋아해요", True),# 기본(실질 발화)
        ("면접 감사합니다", True),           # 키워드 override(잡담보다 먼저)
        ("네?", False),                      # 의문사 없음 + filler → 스킵
        ("워라밸?", True),                   # ? 신호(명사형 짧은 질문, filler 아님) → 실행
        ("안녕하세요, 취업 준비 어떻게 해요?", True),  # 질문+키워드
    ],
)
def test_rag_decision_default(text, expected):
    assert rag_gate.should_run_rag(text) is expected


def test_skip_reason_values():
    assert rag_gate.rag_decision("네 알겠습니다 감사해요") == (False, "chitchat")
    assert rag_gate.rag_decision("안녕")[1] == "short"
    assert rag_gate.rag_decision("포트폴리오 어떻게 준비해요") == (True, "run")


def test_toggle_off_reproduces_length_gate(monkeypatch):
    # 토글 OFF → 기존 동작(len>=8만). 짧은 질문도 스킵, 긴 잡담도 실행.
    monkeypatch.setattr(settings, "rag_selective_skip", False)
    assert rag_gate.should_run_rag("기획자 뭐야?") is False        # 7자 → 스킵(기존)
    assert rag_gate.should_run_rag("네 알겠습니다 감사해요") is True # 11자 → 실행(기존)


def _chunk(job_code):
    return SimpleNamespace(job_code=job_code, source=f"{job_code}/p.md", content="...")


@pytest.mark.parametrize(
    "jobs, expected_jobs",
    [
        ([], []),                                          # 빈 결과
        (["a"], ["a"]),                                    # 단일 후보 → 사용
        (["a", "a", "b"], ["a", "a"]),                     # 최상위 직무 지배(2청크) → 좁힘
        (["a", "b", "c"], []),                             # 흩어짐(각 1) → 범용(주입 생략)
        (["jm-02", "jm-03", "jm-04", "jm-05"], []),        # 세종 계열오염 예시 → 범용
        (["jm-02", "jm-02", "jm-03"], ["jm-02", "jm-02"]), # 특정직무 지배 → 좁힘
        (["a", "a", "a", "a"], ["a", "a", "a"]),           # top_k=3 절단
    ],
)
def test_scope_chunks(jobs, expected_jobs):
    scoped = rag_gate.scope_chunks([_chunk(j) for j in jobs], top_k=3)
    assert [c.job_code for c in scoped] == expected_jobs
