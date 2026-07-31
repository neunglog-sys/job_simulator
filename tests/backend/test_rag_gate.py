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
        # v2 — 1등이 아니어도 최빈이면 채택. 골든셋 실측에서 이 유형이 게이트 탈락의
        # 2/3을 차지했다(정답 직무가 최다인데 1등이 아니라 6개 전부 폐기됨).
        (["b", "a", "c", "a", "a", "d"], ["a", "a", "a"]),
        # v2 — 동률(2:2)이면 거리 합(=순위 합)이 작은 쪽. a는 0+2, b는 1+3.
        (["a", "b", "a", "b"], ["a", "a"]),
        # v2 — 1등 직무가 동률에서 지는 경우도 순위 합으로 갈린다. b는 1+2+4, a는 0+3+5.
        (["a", "b", "b", "a", "b", "a"], ["b", "b", "b"]),
        # v2 — 최빈이어도 2청크 미만이면 지배 없음 → 주입 생략(기존 정책 유지)
        (["a", "b", "c", "d"], []),
    ],
)
def test_scope_chunks(jobs, expected_jobs):
    scoped = rag_gate.scope_chunks([_chunk(j) for j in jobs], top_k=3)
    assert [c.job_code for c in scoped] == expected_jobs


def test_consultation_top_k_carries_a_full_stage_set():
    """상담 주입 상한은 한 직무의 단계 수(5)를 담을 수 있어야 한다.

    scope_chunks는 결과를 단일 직무로 붕괴시키는데, 그 직무의 청크는 단계 5개
    (업무요청 이해/자료·현황 확인/처리·제작·응대/검수·판단/보고·인계)로 나뉜다.
    상한이 3이면 정답 단계가 밀려 빠진다 — 실측(0728, 골든셋 40건)에서 실패는
    전부 이 유형이었고 직무 오염은 0이었다. 3 → 5로 올려 정답 근거 포함이
    추천 스코프 적중 시 95.0% → 100.0%가 됐다.
    """
    from app.domains.consultation.service import RAG_TOP_K

    one_job_all_stages = [_chunk("J012") for _ in range(5)]
    scoped = rag_gate.scope_chunks(one_job_all_stages, top_k=RAG_TOP_K)
    assert len(scoped) == 5, (
        f"주입 상한 {RAG_TOP_K}가 단계 5개를 못 담는다 — 정답 단계가 밀려 빠진다"
    )
