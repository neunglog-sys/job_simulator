"""맞춤 제도 카드 — 규칙 필터·인용 검증.

외부 API·LLM에 의존하지 않는 부분만 검증한다(실제 호출 확인은 scripts/policy_card_smoke.py).
여기서 지키려는 것은 두 가지다.
- 사용자와 무관한 대상 전용 제도가 새어 나가지 않을 것
- LLM이 지어낸 제도명이 카드에 실리지 않을 것 (사용자가 없는 제도를 신청하러 가면 안 된다)
"""

from app.domains.policy import codes, service


def _cond(**over):
    base = {
        "서비스ID": "S1",
        codes.JA_GENDER_MALE: "Y",
        codes.JA_GENDER_FEMALE: "Y",
        codes.JA_AGE_MIN: "18",
        codes.JA_AGE_MAX: "65",
    }
    base.update(over)
    return base


def _svc(name="테스트 제도", field=codes.FIELD_EMPLOYMENT, summary="취업을 지원합니다"):
    return {
        "S1": {
            "서비스ID": "S1",
            "서비스명": name,
            "서비스목적요약": summary,
            "소관기관명": "고용노동부",
            "서비스분야": field,
            "상세조회URL": "https://example.test/s1",
        }
    }


def test_age_outside_range_is_dropped():
    out = service._filter_gov24(
        _svc(), [_cond(**{codes.JA_AGE_MIN: "19", codes.JA_AGE_MAX: "34"})],
        age=47, gender="male", has_disability=False,
    )
    assert out == []


def test_gender_only_service_is_dropped():
    """여성 전용 제도가 남성 사용자에게 나가면 안 된다."""
    out = service._filter_gov24(
        _svc(), [_cond(**{codes.JA_GENDER_MALE: None})],
        age=30, gender="male", has_disability=False,
    )
    assert out == []


def test_special_target_service_is_dropped_when_user_not_matching():
    """농업인 전용 제도는 일반 사용자에게 나가면 안 된다."""
    out = service._filter_gov24(
        _svc(), [_cond(**{"JA0313": "Y"})],
        age=30, gender="male", has_disability=False,
    )
    assert out == []


def test_disability_service_kept_only_for_disabled_user():
    conditions = [_cond(**{codes.JA_DISABILITY: "Y"})]
    kept = service._filter_gov24(_svc(), conditions, age=30, gender="male", has_disability=True)
    dropped = service._filter_gov24(_svc(), conditions, age=30, gender="male", has_disability=False)
    assert len(kept) == 1 and dropped == []


def test_startup_service_is_dropped():
    """'고용·창업'이 한 분야로 묶여 있어 창업은 이름·요약으로 걸러야 한다."""
    out = service._filter_gov24(
        _svc(name="1인 창업 지원사업"), [_cond()],
        age=30, gender="male", has_disability=False,
    )
    assert out == []


def test_non_employment_field_is_dropped():
    out = service._filter_gov24(
        _svc(field="보건·의료"), [_cond()], age=30, gender="male", has_disability=False,
    )
    assert out == []


def test_other_region_service_is_dropped_but_national_kept():
    """다른 시군구 전용은 빼되, 지역이 없는 전국 제도는 남긴다(타지 취업 희망자도 있으므로)."""
    rows = [
        {"name": "양주시 청년수당", "summary": "취업 지원", "theme": "일자리",
         "ctpv": "경기도", "sgg": "양주시", "provider": "", "link": ""},
        {"name": "과천시 청년수당", "summary": "취업 지원", "theme": "일자리",
         "ctpv": "경기도", "sgg": "과천시", "provider": "", "link": ""},
        {"name": "전국 취업지원", "summary": "취업 지원", "theme": "일자리",
         "ctpv": "", "sgg": "", "provider": "", "link": ""},
    ]
    names = [r["name"] for r in service._filter_bokjiro(rows, ctpv="경기도", sgg="양주시")]
    assert "과천시 청년수당" not in names
    assert {"양주시 청년수당", "전국 취업지원"} <= set(names)
    assert names[0] == "양주시 청년수당"  # 거주지 제도가 먼저 온다


def test_life_code_mapping_switches_at_midlife():
    """나이가 바뀌면 검색하는 생애주기가 실제로 달라져야 한다."""
    assert codes.life_codes_for_age(24) == ["004"]
    assert "005" in codes.life_codes_for_age(33)  # 경계는 청년·중장년 둘 다
    assert codes.life_codes_for_age(47) == ["005"]


def test_cited_policies_detects_real_and_fabricated_names():
    candidates = [
        {"name": "경기청년 매치업 플러스(북부특화형)", "link": "https://example.test/a"},
        {"name": "청년 어학·자격시험 응시료 지원사업", "link": "https://example.test/b"},
    ]
    real = service._cited_policies(
        "경기청년 매치업 플러스(북부특화형)는 일 경험을 제공합니다.", candidates
    )
    assert [c["name"] for c in real] == ["경기청년 매치업 플러스(북부특화형)"]

    # 지어낸 이름만 언급하면 인용 0건 → 호출부가 카드를 생략한다
    assert service._cited_policies("청년만능지원금은 매달 100만원을 줍니다.", candidates) == []


def test_cited_policies_tolerates_spacing_difference():
    """제도명 표기가 띄어쓰기만 다른 경우도 인용으로 인정한다."""
    candidates = [{"name": "부산 4050 채용 촉진 지원사업", "link": ""}]
    assert len(service._cited_policies("부산4050채용촉진지원사업을 활용해보세요.", candidates)) == 1
