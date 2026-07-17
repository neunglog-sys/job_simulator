"""시나리오 표현 다듬기(polish-scenarios) 이후의 콘텐츠 계약.

라벨·제목·절차는 바꿔도 되지만, 이것들이 깨지면 게임이 조용히 망가진다:
  · 정답 키가 보기 키 집합 안에 있어야 함 (없으면 아무도 통과 못 함)
  · 보기 키가 유일해야 함 (중복이면 채점이 엉킴)
  · 절차(브리핑)와 보기가 글자까지 같으면 '보고 베끼기'가 됨 — 뜻으로 골라야 한다는 설계 위반
  · 제목이 상황유형(내부 분류) 그대로면 화면에 분류 용어가 노출됨
"""

import glob
import re
from pathlib import Path

import pytest
import yaml

_SCENARIOS = sorted(glob.glob("data/scenarios/*.yaml"))
_MARKS = re.compile(r"\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*")


def _steps():
    for path in _SCENARIOS:
        doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        for step in doc.get("steps", []):
            yield Path(path).stem, step


def _answer_keys(task: dict) -> set[str]:
    answer = task.get("answer") or {}
    return set(answer.get("keys") or ([answer["key"]] if answer.get("key") else []))


@pytest.mark.parametrize("slug,step", list(_steps()), ids=lambda v: v if isinstance(v, str) else v.get("id", ""))
def test_answer_keys_exist_in_options(slug, step):
    task = step.get("task") or {}
    options = task.get("options") or []
    if not options:
        return
    keys = {o["key"] for o in options}
    assert len(keys) == len(options), f"{slug} {step['id']}: 보기 key 중복"
    missing = _answer_keys(task) - keys
    assert not missing, f"{slug} {step['id']}: 정답 키가 보기에 없음 {missing} — 아무도 통과 못 한다"


def test_options_are_not_verbatim_copies_of_procedure():
    """보기가 절차와 글자까지 같으면 브리핑을 보고 그대로 베끼면 된다 — 뜻으로 고르게 하는 설계 위반."""
    offenders = []
    for slug, step in _steps():
        task = step.get("task") or {}
        guide = (task.get("hints") or {}).get("answer_guide")
        options = task.get("options") or []
        if not guide or not options:
            continue
        procedure = {p.strip(" ,.·") for p in _MARKS.split(guide) if p.strip(" ,.·")}
        exact = {o["label"].strip(" ,.·") for o in options} & procedure
        if exact:
            offenders.append(f"{slug} {step['id']}: {sorted(exact)[:2]}")
    assert not offenders, "절차와 글자까지 같은 보기가 남아 있음:\n" + "\n".join(offenders[:10])


def test_titles_are_not_internal_type_labels():
    """제목이 상황유형(정상업무·자료·정보 누락 등)이면 내부 분류가 사용자 화면에 그대로 나간다."""
    offenders = [
        f"{slug} {step['id']}: {step.get('title')!r}"
        for slug, step in _steps()
        if step.get("title") and step.get("title") == step.get("type")
    ]
    assert not offenders, "제목이 상황유형 그대로인 스텝:\n" + "\n".join(offenders[:10])


def test_procedure_items_are_sentences_not_keywords():
    """절차가 '보호구' 같은 키워드면 사수 브리핑이 무슨 말인지 알 수 없다."""
    offenders = []
    for slug, step in _steps():
        guide = ((step.get("task") or {}).get("hints") or {}).get("answer_guide")
        if not guide:
            continue
        parts = [p.strip(" ,.·") for p in _MARKS.split(guide) if p.strip(" ,.·")]
        if parts and sum(len(p) for p in parts) / len(parts) < 8:
            offenders.append(f"{slug} {step['id']}: {parts[:3]}")
    assert not offenders, "절차가 키워드 나열인 스텝:\n" + "\n".join(offenders[:10])


def test_glossary_does_not_break_compound_words():
    """용어 풀이가 더 긴 단어 중간에 끼면 단어가 깨진다 — "출고(물건을 내보냄)지시서".

    용어 뒤에 조사·어미가 아니라 다른 명사가 이어지면 그 자리는 합성어의 일부다.
    """
    particles = (
        "을", "를", "이", "가", "은", "는", "의", "에", "와", "과", "로", "도", "만",
        "한", "해", "하", "된", "될", "인", "부터", "까지", "에서", "으로", "에게", "께",
    )
    offenders = []
    for path in _SCENARIOS:
        text = Path(path).read_text(encoding="utf-8")
        for match in re.finditer(r"([가-힣]{2,6})\(([^)]{2,14})\)([가-힣]{1,6})", text):
            if not match.group(3).startswith(particles):
                offenders.append(f"{Path(path).stem}: {match.group(0)}")
    assert not offenders, "용어 풀이가 합성어를 쪼갬:\n" + "\n".join(offenders[:10])
