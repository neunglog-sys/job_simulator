"""미니게임 다중 지원 — 한 직무에 게임 2~3개.

기존 44개 파일은 '파일 1개 = 게임 1개' 형식이라, 다중화하면서 그 형식이 계속 읽혀야 한다
(하위호환). 새 형식은 최상위 `games:` 리스트로 2~3개를 붙인다.
"""

import textwrap

from app.content import minigame
from app.core.config import settings

LEGACY_SINGLE = """\
scenario_id: demo-01
engine: match
title: 단일 게임
intro: 기존 형식
pass_score: 70
data:
  left: []
  right: []
"""

MULTI = """\
scenario_id: demo-02
games:
  - engine: sort
    title: 물류창고 물건 가져오기
    step: m2
    pass_score: 70
    data: { bins: [] }
  - id: custom-id
    engine: spot
    title: 손님 응대
    pass_score: 60
    data: { cards: [] }
"""


def _write(tmp_path, slug: str, body: str, monkeypatch):
    games_dir = tmp_path / "minigames"
    games_dir.mkdir(exist_ok=True)
    (games_dir / f"{slug}.yaml").write_text(textwrap.dedent(body), encoding="utf-8")
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    minigame.clear_caches()


def test_legacy_single_game_still_loads(tmp_path, monkeypatch):
    """기존 형식(최상위 engine/data) — 1개짜리 목록으로 감싸여 그대로 읽힌다."""
    _write(tmp_path, "demo-01", LEGACY_SINGLE, monkeypatch)

    games = minigame.minigames_for("demo-01")
    assert len(games) == 1
    assert games[0]["engine"] == "match"
    assert games[0]["id"] == "demo-01"
    assert games[0]["step"] is None
    # 게임 1개만 쓰던 호출부가 계속 동작해야 한다
    assert minigame.minigame_for("demo-01")["engine"] == "match"


def test_multi_games_load_in_order(tmp_path, monkeypatch):
    """새 형식(games: 리스트) — 직무당 2개가 순서대로, step·id까지 실려 나온다."""
    _write(tmp_path, "demo-02", MULTI, monkeypatch)

    games = minigame.minigames_for("demo-02")
    assert [g["engine"] for g in games] == ["sort", "spot"]
    assert games[0]["title"] == "물류창고 물건 가져오기"
    assert games[0]["step"] == "m2"  # 이 스텝에서 띄우라는 신호
    # id 미지정이면 scenario_id-순번, 지정하면 그 값을 쓴다
    assert games[0]["id"] == "demo-02-1"
    assert games[1]["id"] == "custom-id"
    # 하위호환 진입점은 첫 게임을 준다
    assert minigame.minigame_for("demo-02")["engine"] == "sort"


def test_missing_file_returns_empty(tmp_path, monkeypatch):
    """게임 데이터가 아직 없는 시나리오도 4단계를 통과해야 하므로 예외 대신 빈 목록."""
    _write(tmp_path, "demo-03", LEGACY_SINGLE, monkeypatch)

    assert minigame.minigames_for("no-such-scenario") == []
    assert minigame.minigame_for("no-such-scenario") is None


def test_broken_game_entry_is_skipped_not_fatal(tmp_path, monkeypatch):
    """한 게임이 망가져도 나머지는 살린다 — 하나 때문에 직무 전체가 '준비 중'이 되면 안 된다."""
    _write(
        tmp_path,
        "demo-04",
        """\
        scenario_id: demo-04
        games:
          - engine: 없는엔진
            title: 깨진 게임
            data: {}
          - engine: spot
            title: 멀쩡한 게임
            data: { cards: [] }
        """,
        monkeypatch,
    )

    games = minigame.minigames_for("demo-04")
    assert [g["engine"] for g in games] == ["spot"]


def test_declared_for_engine_picks_the_matching_game(monkeypatch, tmp_path):
    """다중 게임에서 2번째 게임 결과가 engine_mismatch로 버려지면 안 된다."""
    from app.content import minigame

    monkeypatch.setattr(
        minigame, "minigames_for",
        lambda slug: [{"engine": "match", "pass_score": 70},
                      {"engine": "puzzle", "pass_score": 60}],
    )
    assert minigame.declared_for_engine("sns-01", "puzzle")["engine"] == "puzzle"
    assert minigame.declared_for_engine("sns-01", "match")["engine"] == "match"
    # 선언에 없는 엔진이면 첫 게임과 대조 → 기존처럼 불일치로 기록된다
    assert minigame.declared_for_engine("sns-01", "unknown")["engine"] == "match"


def test_result_is_accepted_when_it_matches_any_declared_game(monkeypatch):
    """두 번째 게임의 engine으로 와도 통과해야 한다 — 첫 게임하고만 비교하면 전부 버려진다.

    kts-03처럼 두 게임의 engine이 같은 경우도 있지만, 다른 조합이면 예전 코드는
    2번째 게임 결과를 통째로 engine_mismatch로 떨궜다.
    """
    from app.content import minigame
    from app.domains.simulation import service

    monkeypatch.setattr(
        minigame, "minigames_for",
        lambda slug: [{"engine": "match", "pass_score": 70},
                      {"engine": "sort", "pass_score": 60}],
    )
    second = service._minigame_result(
        {"engine": "sort", "accuracy": 80}, minigame.declared_for_engine("x", "sort")
    )
    assert not second.get("rejected")
    assert second["passed"] is True

    # 선언에 없는 엔진은 예전처럼 불일치로 기록된다(저장은 하되 점수엔 안 들어감)
    bogus = service._minigame_result(
        {"engine": "bogus", "accuracy": 99}, minigame.declared_for_engine("x", "bogus")
    )
    assert bogus["rejected"] == "engine_mismatch"
