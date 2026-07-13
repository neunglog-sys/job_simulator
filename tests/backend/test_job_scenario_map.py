"""job_scenario_map — 적성(추천 직무) → 체험(시나리오) 연결 데이터 무결성.

매핑 YAML은 자동 생성 후 사람이 검수·수정하는 파일이라, 오타·존재하지 않는
slug가 조용히 들어오기 쉽다 → 여기서 참조 무결성을 강제한다.
"""

from app.content.loader import load_job_scenario_map, load_jobs, yaml_scenario_slugs


def test_map_values_are_existing_scenario_slugs():
    mapping = load_job_scenario_map()
    assert mapping, "매핑 파일이 비어있음 — data/recommendation/job_scenario_map.yaml 확인"
    slugs = yaml_scenario_slugs()
    bad = {k: v for k, v in mapping.items() if v not in slugs}
    assert not bad, f"존재하지 않는 시나리오를 참조: {bad}"


def test_map_keys_are_existing_job_codes():
    mapping = load_job_scenario_map()
    codes = {j["code"] for j in load_jobs()}
    bad = [k for k in mapping if k not in codes]
    assert not bad, f"존재하지 않는 직무 코드: {bad}"


def test_recommendable_jobs_are_covered():
    # 추천 후보(competencies 보유) 직무는 전부 체험 연결이 있어야 함 — 새 직무 YAML을
    # 추가하면 map_jobs_to_scenarios를 재실행하라는 신호
    mapping = load_job_scenario_map()
    recommendable = {j["code"] for j in load_jobs() if j.get("competencies")}
    missing = recommendable - set(mapping)
    assert not missing, f"체험 연결 없는 추천 직무: {sorted(missing)[:10]} (매핑 재생성 필요)"
