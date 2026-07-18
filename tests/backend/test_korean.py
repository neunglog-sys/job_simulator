"""한국어 조사 — NPC 이름을 문장에 끼워 넣을 때 받침에 맞는 조사를 고른다.

"김세라이(가) 다급하게 찾아왔다"가 돌발 퀘스트 등장 대사로 나가던 것을 고치며 추가.
이름은 콘텐츠·LLM이 만들어 미리 알 수 없으므로 렌더 시점에 골라야 한다.
"""

import glob
import re
from pathlib import Path

import pytest

from app.content.korean import josa, with_josa


@pytest.mark.parametrize(
    "name,expected",
    [
        ("김세라", "김세라가"),  # 라 — 받침 없음
        ("김만철", "김만철이"),  # 철 — 받침 있음
        ("정미래", "정미래가"),
        ("유예린", "유예린이"),
        ("손다은", "손다은이"),
        ("박도윤", "박도윤이"),
    ],
)
def test_subject_particle(name, expected):
    assert with_josa(name, "이") == expected


def test_other_particles():
    assert with_josa("김세라", "은") == "김세라는"
    assert with_josa("김만철", "은") == "김만철은"
    assert with_josa("김세라", "을") == "김세라를"
    assert with_josa("김만철", "을") == "김만철을"
    assert with_josa("김세라", "과") == "김세라와"
    assert with_josa("김만철", "과") == "김만철과"


def test_non_hangul_falls_back_to_no_batchim_form():
    # 영문 이름 등은 규칙을 단정할 수 없다 — 어색하지 않은 쪽(받침 없음)으로
    assert josa("Alex", "이") == "가"
    assert josa("", "이") == "가"


def test_no_unresolved_particle_placeholders_in_content():
    """'이(가)' 같은 미해결 조사 표기가 콘텐츠에 남아 있으면 그대로 화면에 나간다."""
    offenders = []
    for path in sorted(glob.glob("data/scenarios/*.yaml")):
        text = Path(path).read_text(encoding="utf-8")
        for match in re.finditer(r"\S*(이\(가\)|을\(를\)|은\(는\)|과\(와\))", text):
            offenders.append(f"{Path(path).stem}: {match.group(0)}")
    assert not offenders, "조사 표기가 남아 있음:\n" + "\n".join(offenders[:10])
