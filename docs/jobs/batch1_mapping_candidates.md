# 배치1 직업 매핑 — 조사 담당 잠정 확정 9건 + 팀 검수 대상 5건

- 출처: 워크피디아(wagework.go.kr) `retrieveOccpNvgtEdcData.do` / `retrieveOccpNvgtWageData.do`
  (검색 API `retrieveOccpSrchKwrdListData.do`, 요청 인코딩 EUC-KR)
- 조회일: 2026-07-13
- 동일 공식 직업을 여러 프로젝트 직무가 참조하더라도 **프로젝트 직무별 데이터는 각각
  별도 항목으로 기록**하며 병합·복사하지 않는다(각 항목에 공식 코드만 동일하게 인용).
- 임금 단위: 워크피디아 원문은 **만원**. 아래 `median_annual_krw`는 **원 단위로 환산**한 값.
- `entry_level`은 전 항목 `null` — 이 데이터는 재직자 대상 통계이며 신입 초임 근거가
  아님. `avgSalChartDataList`/`posSalChartDataList`(고용보험 월평균보수·채용공고
  제시임금 추이)도 마찬가지로 신입 초임으로 쓰지 않는다.

---

## A. 조사 담당 잠정 확정 (9건)

```yaml
job_code: j001
project_job_title: 사무보조원
official_mapping:
  code: K000006012
  title: 사무보조원(일반)
  mapping_type: exact_title
  confidence: high
  rationale: 프로젝트 직무명과 공식 직업명이 정확히 일치.
education_requirement:
  value: null
  note: "needKnwgCn 등 edcInfo 전 필드 공백 — 통계 조사 미포함 직업으로 판단."
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics: null
  note: "wageInfo 전 필드 0/null(konetOccpNm도 null) — 임금 조사 대상 아님."
certifications: []
research_status: not_found
status: not_found
missing_fields: [education_requirement, salary, certifications]
```

```yaml
job_code: j002
project_job_title: 행정지원 담당
official_mapping:
  code: K000007517
  title: 총무사무원
  mapping_type: broad
  confidence: medium
  rationale: 범용 행정지원 업무를 대체할 공식 항목으로 총무사무원 채택.
education_requirement:
  value: "고졸 이상(소규모·중소기업), 관련분야 대졸 이상(대기업) — 사업체 규모에 따라 상이"
  source_field: needKnwgCn
  evidence_type: descriptive_text
  note: "경영/경제/법/회계/행정/교육/광고/홍보/무역 전공 시 취업 유리 — 원문 요약."
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 52500000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j003
project_job_title: 총무 담당자
official_mapping:
  code: K000007517
  title: 총무사무원
  mapping_type: exact_title_search_hit
  confidence: high
  rationale: "'담당자'는 실무자급을 시사 — 관리자급인 총무인사관리자(K000006752)는
    제외."
education_requirement:
  value: "고졸 이상(소규모·중소기업), 관련분야 대졸 이상(대기업) — 사업체 규모에 따라 상이"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 52500000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j005
project_job_title: 비품·자산관리 보조
official_mapping:
  code: K000007517
  title: 총무사무원
  mapping_type: broad
  confidence: high
  rationale: 비품·자산관리는 총무 업무 범주에 포함되는 것이 통상적.
education_requirement:
  value: "고졸 이상(소규모·중소기업), 관련분야 대졸 이상(대기업) — 사업체 규모에 따라 상이"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 52500000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j006
project_job_title: 경리사무원
official_mapping:
  code: K000007466
  title: 경리사무원
  mapping_type: exact_title
  confidence: high
  rationale: 프로젝트 직무명과 공식 직업명이 정확히 일치.
education_requirement:
  value: "고졸 이상"
  source_field: needKnwgCn
  evidence_type: descriptive_text
  note: "회계사무원과 유사 업무이나 정해진 절차·매뉴얼·전산시스템 사용 위주라
    요구 학력·전문지식이 상대적으로 낮은 편으로 원문에 명시됨."
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 35000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
  - name: "전산세무회계(국가공인 민간)"
    tier: related
  - name: "전산회계운용사 1,2,3급(국가기술)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j007
project_job_title: 회계보조
official_mapping:
  code: K000007487
  title: 회계사무원
  mapping_type: broad
  confidence: high
  rationale: "'회계보조' 업무 범위와 회계사무원 정의가 가장 근접."
education_requirement:
  value: "전문대졸 이상(회계관련 학과)"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 66000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
    cross_check_flag: true
    cross_check_note: "API 원문과 일치하나 절대값이 높아 보임 — 최종 입력 전
      직업코드/제목/stdrYear/모집단을 한 번 더 교차 확인 필요 (아래 '교차확인
      메모' 참고)."
certifications:
  - name: "AT《Accounting Technician》(국가공인 민간)"
    tier: related
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
  - name: "세무회계(국가공인 민간)"
    tier: related
  - name: "원가분석사(국가공인 민간)"
    tier: related
  - name: "재경관리사(국가공인 민간)"
    tier: related
  - name: "전산회계운용사 1,2,3급(국가기술)"
    tier: related
  - name: "회계관리(국가공인 민간)"
    tier: related
research_status: partial
status: cross_check_required
missing_fields: []
```

```yaml
job_code: j008
project_job_title: 정산 담당
official_mapping:
  code: K000007487
  title: 회계사무원
  mapping_type: broad
  confidence: medium
  rationale: "'정산사무원' 독립 항목 없음. 정산 업무가 회계 처리와 밀접해 회계사무원으로
    대체."
education_requirement:
  value: "전문대졸 이상(회계관련 학과)"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 66000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
    cross_check_flag: true
    cross_check_note: "j007과 동일 원본 — 동일하게 교차확인 대상."
certifications:
  - name: "AT《Accounting Technician》(국가공인 민간)"
    tier: related
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
  - name: "세무회계(국가공인 민간)"
    tier: related
  - name: "원가분석사(국가공인 민간)"
    tier: related
  - name: "재경관리사(국가공인 민간)"
    tier: related
  - name: "전산회계운용사 1,2,3급(국가기술)"
    tier: related
  - name: "회계관리(국가공인 민간)"
    tier: related
research_status: partial
status: cross_check_required
missing_fields: []
```

```yaml
job_code: j009
project_job_title: 세금계산서 관리 보조
official_mapping:
  code: K000007466
  title: 경리사무원
  mapping_type: broad
  confidence: medium
  rationale: "경리사무원 needKnwgCn 원문에 '청구서, 계산서의 작성 ... 경비 증빙서류
    정리' 업무가 명시되어 있어, 일상적 세금계산서·전표 처리 업무와 가장 근접."
education_requirement:
  value: "고졸 이상"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 35000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "ERP정보관리사《물류/생산/인사/회계》(국가공인 민간)"
    tier: related
  - name: "전산세무회계(국가공인 민간)"
    tier: related
  - name: "전산회계운용사 1,2,3급(국가기술)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j010
project_job_title: 급여정산 보조
official_mapping:
  code: K000003735
  title: 인사사무원
  mapping_type: broad
  confidence: medium
  rationale: "급여 업무는 통상 인사(HR) 부서 소관. 노무사무원(K000002096, 근로기준·
    노사관계 중심)보다 급여 운영 성격에 더 가까움."
education_requirement:
  value: null
  note: "needKnwgCn 등 edcInfo 전 필드 공백."
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics: null
  note: "wageInfo 조사 필드(avwgCnvAmt/konetOccpNm/stdrYear) 전부 0/null — 임금
    조사 대상 아님. 대안 검토했던 노무사무원(K000002096)도 동일하게 공백 확인됨."
certifications: []
research_status: not_found
status: not_found
missing_fields: [education_requirement, salary, certifications]
```

---

## B. 팀 검수 대상 (5건) — 확정하지 않음

```yaml
job_code: backend-developer
project_job_title: 백엔드 개발자
search_terms_tried: [웹개발자, 응용소프트웨어개발자, 시스템소프트웨어개발자]
candidates:
  - official_code: K000002520
    official_title: 응용소프트웨어엔지니어
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "권장 방향(응용소프트웨어개발자)에 가장 근접한 실재 항목 — 단,
      직업사전에 '응용소프트웨어개발자'라는 정확한 명칭 자체는 존재하지 않음
      (전 검색 결과가 휴대폰/이동통신단말 등 산업 특화 복합명뿐). 서버·API
      개발 범위를 웹으로 한정하지 않는다는 방향성과는 부합."
  - official_code: K000005999
    official_title: 웹프로그래머
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "대안(웹개발자) 방향의 가장 근접 항목."
selected_candidate: null
manual_review_required: true
status: team_review
```

```yaml
job_code: marketer
project_job_title: 마케터
search_terms_tried: ["광고·홍보·마케팅사무원", 마케팅전문가, 온라인마케터, 마케터]
detail_code_verified_out_of_band: K000001069
detail_code_source: "사용자 제공 공식 상세 URL(wagework.go.kr retrieveOccpNvgtDtal.do)"
candidates:
  - official_code: K000001069
    official_title: 광고·홍보·마케팅사무원
    mapping_type: broader_official_occupation
    confidence: medium
    priority: 1
    rationale: "검색 API(retrieveOccpSrchKwrdListData.do)는 이 명칭으로 0건이지만,
      상세 API(retrieveOccpNvgtEdcData.do/WageData.do)를 konetOccpCd로 직접
      호출하면 실제 데이터가 채워져 있음을 확인함:
      needKnwgCn='마케팅·광고·홍보사무원에게 요구되는 학력은...(고졸 이상,
      대기업은 법학/경제학/경영학/무역학/회계학 등 대졸 이상)',
      konetOccpNm='광고·홍보·마케팅사무원'(사용자 제공 명칭과 정확히 일치),
      avwgCnvAmt=5550(만원, 5,550만원), stdrYear='2025'.
      검색 색인 누락과 상세 데이터 부재는 별개 현상 — 검색 0건을 '직업사전에
      존재하지 않음'으로 결론 낸 이전 판단은 오류였음(정정)."
  - official_code: K000005116
    official_title: 마케팅사무원
    mapping_type: related
    confidence: low
    priority: 2
    rationale: "'마케팅사무원' 검색으로 별도로 존재가 확인된 코드(광고·홍보·
      마케팅사무원과는 다른 독립 항목). 다만 상세 조회 시 wageInfo 전 필드
      0/null — 데이터 없음. 참고용으로만 남김, 채택 비권장."
  - official_code: K000007405
    official_title: 웹마케터
    mapping_type: related
    confidence: low
    priority: 3
    rationale: "K000001069가 확인되기 전 차선책이었던 항목. 디지털 마케팅
      범위로 프로젝트 직무를 좁히고 싶을 경우의 대안."
selected_candidate: null
manual_review_required: true
note: "1순위(K000001069)는 실데이터가 확인된 상태. 남은 쟁점은 매핑 정확성이
  아니라 '이 사무직 성격 직업이 프로젝트가 의도한 marketer 역할(콘텐츠/퍼포먼스/
  브랜드 등 실무형 마케터)과 범위가 맞는가'이므로 팀 검수 대상으로 유지."
status: team_review
```

```yaml
job_code: j004
project_job_title: 문서관리 담당
search_terms_tried: [총무사무원, 문서관리원, 자료입력원]
candidates:
  - official_code: K000007517
    official_title: 총무사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "권장 방향과 일치. '문서관리원' 독립 항목이 사전에 없어 총무 업무의
      일부로 흡수된 것으로 간주."
  - official_code: K000006012
    official_title: 사무보조원(일반)
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "대안 방향이나, 이 코드는 j001에서 이미 확인했듯 상세 데이터가
      전부 공백(research_status: not_found) — 선택 시 실질적 데이터 확보 불가."
selected_candidate: null
manual_review_required: true
status: team_review
```

```yaml
job_code: j011
project_job_title: 구매사무 보조
search_terms_tried: [구매사무원, 자재관리사무원]
candidates:
  - official_code: K000006768
    official_title: 자재구매사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "권장 방향('구매사무원에 가장 가까운 공식 항목') 충족 — 사전에
      독립된 '구매사무원' 항목 자체가 없고, '구매사무원'/'자재관리사무원' 두
      검색어 모두에서 공통 상위 노출된 유일한 항목이 이것."
  - official_code: K000002274
    official_title: 자재관리사무원(일반)
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "대안 방향. '(일반)' 표기로 특정 산업 한정이 아닌 범용 항목."
selected_candidate: null
manual_review_required: true
status: team_review
```

```yaml
job_code: j012
project_job_title: 발주관리 담당
search_terms_tried: [구매사무원, 자재관리사무원, 발주사무원]
candidates:
  - official_code: K000006768
    official_title: 자재구매사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "권장 방향 충족. j011과 동일 코드 — 단, j011/j012는 프로젝트 내
      별개 직무이므로 이 문서·향후 YAML에서도 데이터를 병합하지 않고 각각
      독립 기록."
  - official_code: K000002274
    official_title: 자재관리사무원(일반)
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "발주 이후 입고·재고 관리 비중이 크다면 이 쪽으로 변경 가능
      (권장 방향의 대안 그대로)."
selected_candidate: null
manual_review_required: true
status: team_review
```

---

## 교차확인 메모 — 회계사무원(K000007487) 중위임금 6,600만원

- API 원문(`avwgCnvAmt: 6600`, `stdrYear: "2025"`, `konetOccpNm: "회계사무원"`)과
  정확히 일치하며 임의로 만든 값이 아님.
- 다만 절대값이 사무직 재직자 중위임금치고 높은 편. 참고로 같은 방식으로 조회한
  총무사무원 5,250만원 · 경리사무원 3,500만원과 비교해도 격차가 크다.
- 교육 데이터를 함께 보면 어느 정도 설명은 된다: 회계사무원은 재직자의 85%가
  대졸 이상이고(`accrCdAlot4=85`), `needKnwgCn`도 "전문대졸 이상의 회계관련 학과"를
  명시 — 경리사무원(고졸 이상, 대졸 40%)보다 학력 수준이 뚜렷이 높은 재직자
  집단을 대상으로 한 조사로 보인다.
- 그렇다고 해도 "공식 API 값이 맞다"는 것과 "우리 서비스의 신입 참고값으로
  적절하다"는 것은 별개 문제 — 위 9건 중 j007/j008 항목에 `cross_check_flag: true`로
  표시해두었다. 배치1 결과를 실제 반영하기 전 최종 확인이 필요하다.
- **독립 출처 교차검토 시도(2026-07-13) — 미해결**: work.go.kr(고용노동부/
  한국고용정보원 워크넷) 직업정보 상세 페이지(`jobNm=027101`, 회계사무원)에서
  같은 항목의 임금 데이터를 대조하려 했으나, 실제 데이터를 채우는 API
  (`/jobInfo/occuInfo/jobDetailSalData.do`)가 `403 서비스에 권한이 없습니다`로
  차단되어 값 자체는 확인하지 못함. 다만 이 페이지의 임금 안내 문구가
  wagework.go.kr과 **문구까지 동일**함을 확인했다 — "위 임금정보는 직업당 평균
  30명의 재직자를 대상으로 실시한 설문조사 결과로, 재직자의 자기보고에 근거한
  통계치입니다." 이는 work.go.kr과 wagework.go.kr이 서로 독립된 통계가 아니라
  **같은 한국고용정보원 재직자 설문조사 체계를 공유**할 가능성을 시사한다.
  즉 두 출처를 대조해도 "다른 방법론에 의한 검증"이 아니라 "같은 조사의 다른
  스냅샷/연도 차이"에 그칠 수 있어, 애초에 기대한 형태의 독립 교차검증 수단으로는
  한계가 있음. `cross_check_flag`는 그대로 유지하며, 실제 반영 여부는 팀 판단에
  맡긴다.

---

## 수집기 회귀 테스트에 반영할 케이스

1. **검색 API 인코딩**: `경리사무원` 검색 시 EUC-KR 인코딩된 폼 데이터로 요청하면
   `konetOccpCd=K000007466`을 반환해야 한다. UTF-8로 보내면 키워드가 깨져
   `totalRecordCount=0`이 되는 회귀를 잡아야 한다.
2. **검색 색인 ≠ 상세 데이터 존재 범위**: `광고·홍보·마케팅사무원`은 검색 API
   (`retrieveOccpSrchKwrdListData.do`)로는 `totalRecordCount=0`이지만,
   `konetOccpCd=K000001069`로 상세 API(`retrieveOccpNvgtEdcData.do`/
   `retrieveOccpNvgtWageData.do`)를 직접 호출하면 실데이터가 채워져 있다.
   **검색 0건을 "직업사전에 없음"으로 자동 결론 내리면 안 된다** — 수집기는
   검색으로 코드를 못 찾으면 "코드 미상"으로만 표시하고, 사람이 공식 상세
   URL로 직접 확인한 코드가 있으면 그것으로 상세 API를 직접 조회하는 경로를
   항상 열어둬야 한다. `K000001069`를 고정 회귀 케이스로 등록.
3. **상세조사 미포함 코드**: `K000006012`(사무보조원(일반)), `K000003735`
   (인사사무원), `K000002096`(노무사무원)는 검색·상세 코드 조회 자체는 정상
   성공하지만 `edcInfo`/`wageInfo` 내부 필드가 전부 빈 값/0/null이다. 이런
   응답은 `success:true`이므로 API 실패가 아니라 "정상적인 데이터 없음"으로
   처리해야 하며, 수집기가 0을 유효한 임금값으로 오인하지 않도록 회귀
   테스트에 포함한다.
