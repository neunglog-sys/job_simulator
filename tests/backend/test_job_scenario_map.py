"""job_scenario_map — 추천(F 직무군) → 체험(시나리오) 연결 데이터 무결성.

F 개편(2026-07-27): 추천 후보는 F 직무군(f01~f39, f15 결번)뿐이고, 매핑은
"F당 활성 시나리오 최대 1개"다(f37=null은 체험 미연결 확정 — 로더가 걸러낸다).
매핑·원장(f_families)·프로필(data/jobs/f*.yaml)이 사람 손으로 관리되므로
셋의 정합을 여기서 강제한다.
"""

import re

from app.content.loader import (
    load_f_detail_jobs,
    load_f_families,
    load_job_scenario_map,
    load_jobs,
    yaml_scenario_slugs,
)

F_CODE = re.compile(r"f\d{2}")


def _f_profiles() -> dict[str, dict]:
    return {j["code"]: j for j in load_jobs() if F_CODE.fullmatch(j["code"])}


def test_map_values_are_active_scenario_slugs():
    mapping = load_job_scenario_map()
    assert mapping, "매핑 파일이 비어있음 — data/recommendation/job_scenario_map.yaml 확인"
    slugs = yaml_scenario_slugs()
    bad = {k: v for k, v in mapping.items() if v not in slugs}
    assert not bad, f"비활성/부재 시나리오를 참조: {bad} (_disabled로 내렸으면 맵에서도 빼야 함)"


def test_map_keys_are_f_codes_with_profiles():
    # 맵 키는 전부 F 코드여야 하고(레거시 J 매핑 잔재 금지), 각 F는 추천 스코어링에
    # 쓸 프로필 YAML(data/jobs/f*.yaml)이 있어야 한다.
    mapping = load_job_scenario_map()
    not_f = [k for k in mapping if not F_CODE.fullmatch(k)]
    assert not_f == [], f"F 코드가 아닌 매핑 키: {not_f}"
    profiles = _f_profiles()
    missing = [k for k in mapping if k not in profiles]
    assert missing == [], f"프로필 YAML 없는 F: {missing}"


def test_families_match_map_and_have_scorable_profiles():
    # 원장(f_families)이 단일 기준 — 맵과 시나리오가 일치해야 하고, 모든 F는
    # 후보 자격(competencies)과 흥미 프로필을 갖춰야 한다. 시나리오 없는 F(f37)는
    # 원장에 null로 명시돼 있어야 하며 맵에는 나타나지 않는다(로더가 null 필터).
    families = load_f_families()
    assert families, "f_families.yaml이 비어있음"
    mapping = load_job_scenario_map()
    profiles = _f_profiles()

    for fam in families:
        code = fam["code"]
        assert code in profiles, f"{code}: 프로필 YAML 없음"
        prof = profiles[code]
        assert prof.get("competencies"), f"{code}: competencies 비어있음 — 추천 불가"
        assert prof.get("interest_profile"), f"{code}: interest_profile 비어있음"
        if fam.get("scenario"):
            assert mapping.get(code) == fam["scenario"], (
                f"{code}: 원장 시나리오({fam['scenario']})와 맵({mapping.get(code)}) 불일치"
            )
        else:
            assert code not in mapping, f"{code}: 원장은 미연결인데 맵에 존재"

    # 원장 밖의 F가 맵·프로필에 떠돌지 않게 역방향도 확인
    fam_codes = {f["code"] for f in families}
    assert set(mapping) <= fam_codes, f"원장에 없는 맵 키: {set(mapping) - fam_codes}"
    assert set(profiles) <= fam_codes, f"원장에 없는 프로필: {set(profiles) - fam_codes}"


def test_f_profile_keys_are_valid():
    # 역량·흥미 키 오타는 조용히 중립점수(50)로 채점돼 변별력을 죽인다 — 키 집합을 고정.
    COMP = {"situation_judgment", "problem_solving", "communication", "collaboration", "task_management"}
    RIASEC = {"realistic", "investigative", "artistic", "social", "enterprising", "conventional"}
    for code, prof in _f_profiles().items():
        assert set(prof["competencies"]) == COMP, f"{code}: competencies 키 불일치"
        assert set(prof["interest_profile"]) == RIASEC, f"{code}: interest_profile 키 불일치"
        for k, v in {**prof["competencies"], **prof["interest_profile"]}.items():
            assert isinstance(v, int) and 1 <= v <= 5, f"{code}.{k}={v!r} — 1~5 정수 아님"


def test_detail_jobs_cover_all_families():
    # 세부직업(조사 엑셀 변환본)은 모든 F에 존재해야 한다 — 카드·리포트·상담 응답이 쓴다.
    details = load_f_detail_jobs()
    fam_codes = {f["code"] for f in load_f_families()}
    missing = fam_codes - set(details)
    assert missing == set(), f"세부직업 없는 F: {sorted(missing)}"
    empty = [c for c in fam_codes if not details[c].get("primary")]
    assert empty == [], f"primary 세부직업이 빈 F: {empty}"
