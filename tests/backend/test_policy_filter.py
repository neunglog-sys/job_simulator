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


def test_gov24_one_sided_age_bound_still_filters():
    """상한만 적힌 제도가 나이를 무시하고 통과하면 안 된다.

    전에는 상·하한이 둘 다 있을 때만 걸렀다. 그래서 "만 34세 이하"처럼 상한만 적힌
    청년 제도가 68세 계정에도 그대로 나갔다.
    """
    upper_only = [_cond(**{codes.JA_AGE_MIN: None, codes.JA_AGE_MAX: "34"})]
    assert service._filter_gov24(
        _svc(), upper_only, age=68, gender="male", has_disability=False
    ) == []
    assert service._filter_gov24(
        _svc(), upper_only, age=30, gender="male", has_disability=False
    ) != []

    lower_only = [_cond(**{codes.JA_AGE_MIN: "60", codes.JA_AGE_MAX: None})]
    assert service._filter_gov24(
        _svc(), lower_only, age=30, gender="male", has_disability=False
    ) == []
    assert service._filter_gov24(
        _svc(), lower_only, age=68, gender="male", has_disability=False
    ) != []


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


def test_merged_province_matches_across_source_spellings():
    """광주·전남 통합(전남광주통합특별시) — 소스마다 표기가 달라 이름만으로 비교하면 안 된다.

    복지로는 아직 '전라남도'만 쓰고 '광주광역시'는 아예 없다. 표기를 그대로 비교하면
    광주로 저장한 사용자가 그 지역 제도를 한 건도 못 받는다.
    """
    rows = [{"name": "전남 청년 취업지원", "summary": "취업 지원", "theme": "일자리",
             "ctpv": "전라남도", "sgg": "", "provider": "", "link": ""}]
    for saved_as in ("광주광역시", "전라남도", "전남광주통합특별시"):
        kept = service._filter_bokjiro(rows, ctpv=saved_as, sgg=None)
        assert len(kept) == 1, f"{saved_as}로 저장한 사용자가 이 제도를 놓친다"

    # 통합과 무관한 시도까지 뭉뚱그리면 안 된다
    assert service._filter_bokjiro(rows, ctpv="경기도", sgg=None) == []


def test_merged_province_shares_youth_region_code():
    assert codes.YOUTH_CTPV_PREFIX["전남광주통합특별시"] == "12"
    assert codes.YOUTH_CTPV_PREFIX["광주광역시"] == "12"
    assert codes.YOUTH_CTPV_PREFIX["전라남도"] == "12"


def test_life_code_mapping_switches_at_midlife():
    """나이가 바뀌면 검색하는 생애주기가 실제로 달라져야 한다."""
    assert codes.life_codes_for_age(24) == ["004"]
    assert "005" in codes.life_codes_for_age(33)  # 경계는 청년·중장년 둘 다
    assert codes.life_codes_for_age(47) == ["005"]


def _youth(**over):
    base = {
        "plcyNm": "청년 취업지원",
        "plcyExplnCn": "취업을 지원합니다",
        # 시군구 정책은 기관명에 지역명이 들어간다(실측: "인천광역시 서해구 경제환경국 …")
        "sprvsnInstCdNm": "경기도 양주시 일자리경제과",
        "aplyUrlAddr": "https://example.test/y",
        "sprtTrgtAgeLmtYn": "Y",
        "sprtTrgtMinAge": "19",
        "sprtTrgtMaxAge": "34",
        "zipCd": "41630",
    }
    base.update(over)
    return base


def test_youth_age_outside_range_is_dropped():
    assert _filter_youth_names(_youth(), age=47, ctpv="경기도", sgg="양주시") == []
    assert _filter_youth_names(_youth(), age=30, ctpv="경기도", sgg="양주시") != []


def test_youth_age_uses_values_not_the_broken_flag():
    """sprtTrgtAgeLmtYn은 의미가 뒤집혀 있다(실측) — 플래그가 아니라 값으로 걸러야 한다.

    'N'인데 15~34가 들어 있는 행이 409건이고, 'Y'인데 상한이 0인 행이 130건이다.
    플래그를 믿으면 47세에게 청년(15~34) 정책이 그대로 나간다.
    """
    youth_only = _youth(sprtTrgtAgeLmtYn="N", sprtTrgtMinAge="15", sprtTrgtMaxAge="34")
    assert _filter_youth_names(youth_only, age=47, ctpv="경기도", sgg="양주시") == []

    # 상한이 0 = 값 없음. 이 API는 청년 정책 출처라 '제한 없음'이 아니라 '안 적은 청년
    # 정책'으로 본다 — 무제한으로 두면 68세 계정에 청년 제도가 그대로 나간다.
    no_upper = _youth(sprtTrgtAgeLmtYn="Y", sprtTrgtMinAge="0", sprtTrgtMaxAge="0")
    assert _filter_youth_names(no_upper, age=30, ctpv="경기도", sgg="양주시") != []
    assert _filter_youth_names(no_upper, age=34, ctpv="경기도", sgg="양주시") != []
    assert _filter_youth_names(no_upper, age=47, ctpv="경기도", sgg="양주시") == []
    assert _filter_youth_names(no_upper, age=68, ctpv="경기도", sgg="양주시") == []

    # 15~69처럼 넓은 제도는 47세도, 68세도 대상이다 (국민취업지원제도가 이 범위다)
    wide = _youth(sprtTrgtAgeLmtYn="N", sprtTrgtMinAge="15", sprtTrgtMaxAge="69")
    assert _filter_youth_names(wide, age=47, ctpv="경기도", sgg="양주시") != []
    assert _filter_youth_names(wide, age=68, ctpv="경기도", sgg="양주시") != []
    assert _filter_youth_names(wide, age=70, ctpv="경기도", sgg="양주시") == []


def test_youth_other_province_is_dropped():
    seoul = _youth(zipCd="11680")
    assert _filter_youth_names(seoul, age=30, ctpv="경기도", sgg="양주시") == []


def test_youth_nationwide_policy_is_kept_for_everyone():
    """전국 정책은 빈 값이 아니라 전 지역 코드를 나열한다 — 시도 개수로 판정한다."""
    nationwide = _youth(zipCd=",".join(f"{p}110" for p in
                                       ("11", "12", "26", "27", "28", "30", "31", "36",
                                        "41", "43", "44", "47")))
    kept = service._filter_youth([nationwide], age=30, ctpv="경기도", sgg="양주시")
    assert len(kept) == 1 and kept[0]["scope"] == "national"


def test_youth_other_district_in_same_province_is_dropped():
    """같은 경기도라도 과천 전용 정책이 양주 사용자에게 나가면 안 된다."""
    gwacheon = _youth(plcyNm="(과천시) 청년 취업지원", zipCd="41290",
                      sprvsnInstCdNm="경기도 과천시 일자리경제과")
    assert _filter_youth_names(gwacheon, age=30, ctpv="경기도", sgg="양주시") == []
    # 같은 정책도 과천 주민에겐 나가야 한다
    assert _filter_youth_names(gwacheon, age=30, ctpv="경기도", sgg="과천시") != []


def test_youth_unnamed_district_policy_is_dropped_conservatively():
    """시군구 전용인데 이름·기관명 어디에도 지역이 안 드러나면 뺀다.

    사용자 프로필엔 시군구 코드가 없어 확인할 방법이 없다. 남의 동네 제도를 신청하러
    보내는 것보다, 확인 못 한 제도를 빼는 쪽이 낫다고 보고 보수적으로 간다.
    """
    unnamed = _youth(plcyNm="청년 일자리 지원", sprvsnInstCdNm="일자리경제과", zipCd="41630")
    assert _filter_youth_names(unnamed, age=30, ctpv="경기도", sgg="양주시") == []
    # 시군구를 모르는 사용자에겐 확인할 대상이 없으므로 남긴다
    assert _filter_youth_names(unnamed, age=30, ctpv="경기도", sgg=None) != []


def test_youth_province_wide_policy_kept_for_any_district():
    """경기도 전역 정책은 시군구를 많이 나열한다 — 시군구 전용으로 오해하면 안 된다."""
    province = _youth(plcyNm="경기청년 매치업", sprvsnInstCdNm="경기도 일자리경제정책과",
                      zipCd="41111,41113,41115,41117,41131,41630")
    assert _filter_youth_names(province, age=30, ctpv="경기도", sgg="양주시") != []


def test_youth_region_policy_is_dropped_when_residence_unknown():
    """거주지를 모르면 지역 전용 정책은 빼고 전국 정책만 남긴다.

    프로필에 지역을 안 넣은 계정에 대구 달서구·남구 정책이 '맞춤 제도'로 노출됐다
    (2026-07-28 E2E 실측). 거주 요건이 걸려 신청조차 못 하는 제도다.
    """
    gyeonggi = _youth(zipCd="41630")
    assert _filter_youth_names(gyeonggi, age=30, ctpv=None, sgg=None) == []

    nationwide = _youth(plcyNm="전국 청년 취업지원", zipCd=",".join(
        f"{p}110" for p in ("11", "12", "26", "27", "28", "30", "31", "36", "41", "43", "44", "47")
    ))
    assert _filter_youth_names(nationwide, age=30, ctpv=None, sgg=None) != []


def test_bokjiro_region_policy_is_dropped_when_residence_unknown():
    rows = [
        {"name": "대구 달서구 청년수당", "summary": "취업 지원", "theme": "일자리",
         "ctpv": "대구광역시", "sgg": "달서구", "provider": "", "link": ""},
        {"name": "전국 취업지원", "summary": "취업 지원", "theme": "일자리",
         "ctpv": "", "sgg": "", "provider": "", "link": ""},
    ]
    names = [r["name"] for r in service._filter_bokjiro(rows, ctpv=None, sgg=None)]
    assert names == ["전국 취업지원"]


def _filter_youth_names(row, **kw):
    return [r["name"] for r in service._filter_youth([row], **kw)]


def _cand(name, summary=""):
    return {"name": name, "summary": summary, "provider": "", "link": "", "scope": "national"}


def test_big_source_does_not_crowd_out_the_others():
    """소스 하나가 후보 상한을 독차지하면 다른 소스에만 있는 제도가 사라진다.

    실제로 온통청년 126건이 복지로 13건을 전부 밀어내 장애인 제도가 0건이 됐다.
    """
    big = [_cand(f"청년 일자리 {i}") for i in range(100)]
    small = [_cand("장애인 취업성공패키지", "장애인 대상 취업 지원")]
    out = service._merge_and_cap([big, small], has_disability=None)
    assert "장애인 취업성공패키지" in [r["name"] for r in out]


def test_disability_policies_survive_the_candidate_cap():
    """민감정보 동의까지 받고 장애 여부를 저장했는데 관련 제도가 한 건도 안 실리면 안 된다."""
    flood = [_cand(f"청년 일자리 {i}") for i in range(60)]
    disability = [_cand(f"장애인 일자리 지원 {i}", "장애인 대상") for i in range(12)]
    out = service._merge_and_cap([flood, disability], has_disability=True)
    got = sum(1 for r in out if "장애" in r["name"])
    assert got >= service.DISABILITY_MIN_SLOTS
    # 장애 제도만으로 채우지는 않는다 — 일반 제도도 함께 보여야 한다
    assert len(out) == service.MAX_CANDIDATES
    assert got < len(out)


def test_no_disability_means_no_special_ordering():
    flood = [_cand(f"청년 일자리 {i}") for i in range(30)]
    disability = [_cand("장애인 일자리 지원", "장애인 대상")]
    out = service._merge_and_cap([flood, disability], has_disability=False)
    assert out[0]["name"] != "장애인 일자리 지원"


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


def test_dash_sgg_is_treated_as_province_wide():
    """복지로가 '시군구 없음'을 '-'로 주는 행이 있다. 시군구 전용으로 오해하면 도 전체 정책이 사라진다."""
    rows = [{
        "name": "경기도 청년 취업지원", "summary": "취업 지원", "theme": "일자리",
        "ctpv": "경기도", "sgg": "-", "provider": "", "link": "",
    }]
    out = service._filter_bokjiro(rows, ctpv="경기도", sgg="양주시")
    assert len(out) == 1 and out[0]["scope"] == "province"


def test_summary_strips_source_formatting():
    """복지로 원문의 '❍' 글머리·줄바꿈이 화면과 프롬프트로 새어 나가면 안 된다."""
    rows = [{
        "name": "청년 일경험 지원", "theme": "일자리", "ctpv": "", "sgg": "",
        "provider": "", "link": "",
        "summary": "❍ 청년 취업 지원\n❍ 일 경험 기회 제공\n",
    }]
    out = service._filter_bokjiro(rows, ctpv=None, sgg=None)
    assert out[0]["summary"] == "청년 취업 지원 일 경험 기회 제공"


def test_split_output_separates_body_and_extra_list():
    raw = "취업을 준비하는 청년이라면…\n\n---\n- 국민취업지원제도\n- 취업날개 서비스 지원\n"
    body, names = service._split_output(raw)
    assert body == "취업을 준비하는 청년이라면…"
    assert names == ["국민취업지원제도", "취업날개 서비스 지원"]


def test_split_output_survives_missing_separator():
    """목록은 부가 정보다 — 형식이 어긋났다고 카드까지 없애면 안 된다."""
    body, names = service._split_output("문단만 왔다")
    assert body == "문단만 왔다"
    assert names == []


def test_extra_list_drops_fabricated_and_duplicate_names():
    """목록에도 인용 검증을 건다 — 지어낸 제도를 신청하러 가면 안 된다."""
    candidates = [
        {"name": "국민취업지원제도", "link": "a"},
        {"name": "취업날개 서비스 지원", "link": "b"},
        {"name": "서울시 일자리카페 운영", "link": "c"},
    ]
    cited = [candidates[0]]
    out = service._named_policies(
        ["청년만능지원금", "취업날개서비스지원", "국민취업지원제도", "서울시 일자리카페 운영"],
        candidates,
        cited,
    )
    names = [r["name"] for r in out]
    assert "청년만능지원금" not in names        # 지어낸 이름
    assert "국민취업지원제도" not in names      # 본문에 이미 나온 제도는 중복 제외
    assert names == ["취업날개 서비스 지원", "서울시 일자리카페 운영"]  # 띄어쓰기 차이 허용


def test_extra_list_matches_despite_appended_provider():
    """모델이 이름 뒤에 기관명을 덧붙이거나 끝을 흘려 쓴다(실측) — 그래도 찾아내야 한다."""
    candidates = [
        {"name": "참 괜찮은 강소기업 선정 및 취업연계", "link": "a"},
        {"name": "벤처기업 공동채용 지원사업", "link": "b"},
    ]
    out = service._named_policies(
        [
            "참 괜찮은 강소기업 선정 및 취업연계 (중소벤처기업부)",  # 기관명이 붙음
            "벤처기업 공동채용 지원사 (중소벤처기업부)",             # 이름 끝이 잘림
        ],
        candidates,
        [],
    )
    assert [r["name"] for r in out] == [
        "참 괜찮은 강소기업 선정 및 취업연계",
        "벤처기업 공동채용 지원사업",
    ]


def test_extra_list_drops_ambiguous_prefix_match():
    """앞부분이 여러 제도에 걸리면 어느 쪽인지 알 수 없다 — 찍지 말고 버린다."""
    candidates = [
        {"name": "청년 취업지원 사업 A형", "link": "a"},
        {"name": "청년 취업지원 사업 B형", "link": "b"},
    ]
    assert service._named_policies(["청년 취업지원 사업"], candidates, []) == []


def test_cited_policies_tolerates_spacing_difference():
    """제도명 표기가 띄어쓰기만 다른 경우도 인용으로 인정한다."""
    candidates = [{"name": "부산 4050 채용 촉진 지원사업", "link": ""}]
    assert len(service._cited_policies("부산4050채용촉진지원사업을 활용해보세요.", candidates)) == 1
