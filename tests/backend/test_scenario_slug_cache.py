"""yaml_scenario_slugs 캐시 — 요청마다 44개 YAML을 파싱하던 것을 캐싱했다.

캐시가 빨라지는 건 쉬운데, 파일을 고쳐도 반영이 안 되면 더 나쁘다.
여기서 지키는 건 '빨라지되 변경은 따라간다'와 '호출부가 결과를 고쳐도 캐시가 안 깨진다'.
"""

import yaml

from app.content import loader
from app.core.config import settings


def _write_scenario(dirpath, slug):
    (dirpath / f"{slug}.yaml").write_text(
        yaml.safe_dump({"slug": slug}, allow_unicode=True), encoding="utf-8"
    )


def _use_tmp_data(monkeypatch, tmp_path):
    (tmp_path / "scenarios").mkdir()
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    loader.clear_scenario_slug_cache()
    return tmp_path / "scenarios"


def test_slugs_are_cached_and_returned_as_a_copy(monkeypatch, tmp_path):
    scenarios = _use_tmp_data(monkeypatch, tmp_path)
    _write_scenario(scenarios, "kts-03")

    first = loader.yaml_scenario_slugs()
    assert first == {"kts-03"}

    first.add("오염")  # 호출부가 결과를 고쳐도
    assert loader.yaml_scenario_slugs() == {"kts-03"}  # 캐시는 그대로


def test_new_file_is_picked_up_after_ttl(monkeypatch, tmp_path):
    """TTL이 지나면 파일 변경을 따라가야 한다 — 캐시가 옛 목록을 붙들고 있으면
    새로 추가한 시나리오를 '없는 시나리오'라며 404로 막는다."""
    scenarios = _use_tmp_data(monkeypatch, tmp_path)
    _write_scenario(scenarios, "kts-03")
    assert loader.yaml_scenario_slugs() == {"kts-03"}

    _write_scenario(scenarios, "sns-01")
    # TTL 안에는 stat조차 하지 않으므로 아직 예전 목록
    assert loader.yaml_scenario_slugs() == {"kts-03"}

    monkeypatch.setattr(loader, "_scenario_slug_checked_at", 0.0)  # TTL 만료
    assert loader.yaml_scenario_slugs() == {"kts-03", "sns-01"}


def test_missing_directory_does_not_raise(monkeypatch, tmp_path):
    """데이터 폴더가 없어도 500으로 터지면 안 된다."""
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "없는폴더"))
    loader.clear_scenario_slug_cache()
    assert loader.yaml_scenario_slugs() == set()
