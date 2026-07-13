# 배치2 직업 매핑 — 조사 담당 잠정 확정 52건 + 팀 검수 대상 39건

- 대상: j013~j099, j100~j103 (총 91건). 게임 시나리오용 잡파일(`jm-*`, `kts-*`, `ms-*`,
  `stn-*`, `yg-*`, `ys-*`)은 이 조사 대상에서 제외.
- 출처: 워크피디아(wagework.go.kr) `retrieveOccpNvgtEdcData.do` /
  `retrieveOccpNvgtWageData.do` (검색 API `retrieveOccpSrchKwrdListData.do`),
  일부 판단에는 한국직업사전 상세 API `retrieveOccpDctnDtalData.do`(dtyCn=직무개요
  텍스트)를 보조적으로 활용해 후보 간 업무 정의를 대조함.
- 조회일: 2026-07-13
- **배치1 대비 방법론 정정**: 배치1 문서는 검색 API 요청 인코딩을 EUC-KR로 기록했으나,
  실제로는 **UTF-8** 폼 인코딩이어야 정상 동작한다(EUC-KR 전송 시 키워드가 깨져
  `searchKeyword` 필드가 mojibake로 응답되고 `totalRecordCount=0`이 반환됨을 재현
  확인). 배치2는 전 구간 UTF-8로 재검증했으며, 기준 사례
  `경리사무원 → K000007466`도 동일하게 재현되었다. 자세한 내용은 본 문서 하단
  "방법론 재검증 메모" 참고.
- 동일 공식 직업을 여러 프로젝트 직무가 참조하더라도 **프로젝트 직무별 데이터는 각각
  별도 항목으로 기록**하며 병합·복사하지 않는다(각 항목에 공식 코드만 동일하게 인용).
- 임금 단위: 워크피디아 원문은 **만원**. 아래 `median_annual_krw`는 **원 단위로 환산**한 값.
- `entry_level`은 전 항목 `null` — 이 데이터는 재직자 대상 통계이며 신입 초임 근거가
  아님.
- **"검색 API 0건" ≠ "직업사전에 없음"**: 배치1에서 확인된 바와 같이(K000001069 사례),
  검색 색인 누락과 상세 API 데이터 부재는 별개 현상이다. 배치2에서도 검색 0건인
  키워드는 상세 API 코드 직접조회를 시도했으나, YAML에 반영한 52건은 모두 검색
  API에서 후보 코드 자체는 확인된 것들이다(코드가 아예 없는 경우는 팀 검수로 이관).

---

## A. 조사 담당 잠정 확정 (52건)

```yaml
job_code: j013
project_job_title: 자재관리 보조
official_mapping:
  code: K000002274
  title: 자재관리사무원(일반)
  mapping_type: broad
  confidence: high
  rationale: "자재 소요계획 수립·적정재고 유지관리라는 정의가 '자재관리 보조' 업무와 정확히 부합."
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
job_code: j015
project_job_title: 물류사무원
official_mapping:
  code: K000002383
  title: 물류관리사무원
  mapping_type: near_exact
  confidence: high
  rationale: "'물류사무원'과 '물류관리사무원' 명칭이 근접, 입출고·재고관리 정의도 일치."
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
job_code: j018
project_job_title: 재고관리 사무
official_mapping:
  code: K000002383
  title: 물류관리사무원
  mapping_type: broad
  confidence: medium
  rationale: "물류관리사무원 정의에 '적정 재고상태 유지'가 명시돼 재고관리 사무와 부합. (j015와 동일 코드, 별도 기록)"
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
job_code: j019
project_job_title: 출고관리 사무
official_mapping:
  code: K000001625
  title: 제품출하사무원
  mapping_type: broad
  confidence: high
  rationale: "제품재고관리·출하 부두작업 확인·제품수불 관리 등 정의가 출고관리 업무와 정확히 부합."
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
job_code: j020
project_job_title: 채용운영 보조
official_mapping:
  code: K000003735
  title: 인사사무원
  mapping_type: broad
  confidence: medium
  rationale: "채용은 인사사무원 정의(채용·교육·평가·보상·입퇴사 등 인사관리)에 포함된 하위업무."
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
job_code: j021
project_job_title: 교육운영 보조
official_mapping:
  code: K000002421
  title: 교육훈련사무원
  mapping_type: exact_ish
  confidence: high
  rationale: "교육훈련 프로그램 기획·진행이라는 정의가 '교육운영 보조'와 정확히 부합."
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
job_code: j023
project_job_title: 근태관리 보조
official_mapping:
  code: K000003735
  title: 인사사무원
  mapping_type: broad
  confidence: medium
  rationale: "근태관리는 인사관리 범주의 하위업무 (j020과 동일 코드, 별도 기록)."
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
job_code: j024
project_job_title: 면접일정 조율 담당
official_mapping:
  code: K000003735
  title: 인사사무원
  mapping_type: broad
  confidence: medium
  rationale: "면접 일정조율은 채용업무의 일부로 인사사무원 정의에 포함 (j020/j023과 동일 코드, 별도 기록)."
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
job_code: j025
project_job_title: 콘텐츠 마케터
official_mapping:
  code: K000001069
  title: 광고·홍보·마케팅사무원
  mapping_type: broader_official_occupation
  confidence: medium
  rationale: "batch1 marketer.yaml과 동일 논리 — 마케팅 전반을 다루는 공식 항목 중 유일하게 실데이터 확보(검색 색인 누락과 별개로 상세 API 직접조회 시 데이터 존재)."
education_requirement:
  value: "고졸 이상 — 대기업은 법학/경제학/경영학/무역학/회계학 등 대졸 이상"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 55500000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  []
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j026
project_job_title: 퍼포먼스마케팅 보조
official_mapping:
  code: K000007413
  title: 퍼포먼스마케터
  mapping_type: exact_title
  confidence: high
  rationale: "'퍼포먼스마케팅'과 '퍼포먼스마케터' 명칭이 정확히 일치."
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
job_code: j027
project_job_title: 브랜드홍보 보조
official_mapping:
  code: K000003274
  title: 홍보사무원
  mapping_type: broad
  confidence: high
  rationale: "'브랜드홍보'의 핵심인 홍보 업무를 다루는 공식 항목."
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
job_code: j030
project_job_title: SNS 운영자
official_mapping:
  code: K000002314
  title: 소셜네트워크서비스마케터
  mapping_type: exact_ish
  confidence: high
  rationale: "SNS(블로그·트위터·페이스북 등) 디지털 매체 활용 마케팅업무 정의가 'SNS 운영자'와 정확히 부합."
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
job_code: j035
project_job_title: 상품기획·MD 보조
official_mapping:
  code: K000001247
  title: 머천다이저
  mapping_type: exact_title
  confidence: high
  rationale: "'MD'의 정식 한글 표기가 머천다이저 — 명칭 자체가 정확히 일치."
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
job_code: j037
project_job_title: 행사·전시 운영 보조
official_mapping:
  code: K000004998
  title: 행사기획연출가
  mapping_type: broad
  confidence: medium
  rationale: "축제/문화행사 기획·연출 및 현장운영 총괄이라는 정의가 '행사·전시 운영' 업무와 부합."
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
job_code: j039
project_job_title: 데이터분석 보조
official_mapping:
  code: K000004005
  title: 데이터분석가(일반)
  mapping_type: exact_title
  confidence: high
  rationale: "'(일반)' 표기의 범용 데이터분석가 항목 — 명칭이 정확히 일치."
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
job_code: j041
project_job_title: 매출 리포트 담당
official_mapping:
  code: K000007550
  title: 통계사무원
  mapping_type: broad
  confidence: high
  rationale: "각종 통계데이터 수집·정리·기본 통계처리 업무 정의가 '매출 리포트' 작성 업무와 부합."
education_requirement:
  value: "전문대졸 이상 — 경영학/통계학/신문방송학/심리학/사회학 등 사회과학 전공 권장"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 30000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2023
certifications:
  []
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j042
project_job_title: 데이터 라벨링 관리
official_mapping:
  code: K000007166
  title: 데이터라벨링검수원
  mapping_type: exact_ish
  confidence: high
  rationale: "업로드 데이터·라벨값이 가이드라인에 일치하는지 점검·수정한다는 정의가 '라벨링 관리(검수 총괄)' 업무와 정확히 부합(단순 라벨러 K000007194와는 구분)."
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
job_code: j044
project_job_title: 인바운드 상담사
official_mapping:
  code: K000004177
  title: 컨텍센터상담원
  mapping_type: broad
  confidence: high
  rationale: "전화·인터넷 접수 고객상담·텔레마케팅 정의가 인바운드 상담업무와 부합."
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
job_code: j045
project_job_title: 온라인 CS 담당
official_mapping:
  code: K000004177
  title: 컨텍센터상담원
  mapping_type: broad
  confidence: medium
  rationale: "온라인 채널 고객문의 대응도 컨텍센터상담원 업무범주에 포함 (j044와 동일 코드, 별도 기록)."
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
job_code: j048
project_job_title: 예약·접수 상담원
official_mapping:
  code: K000005000
  title: 예약접수원
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j049
project_job_title: 매장 판매원
official_mapping:
  code: K000008001
  title: 매장판매원(일반)
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j050
project_job_title: 온라인 판매 운영자
official_mapping:
  code: K000006507
  title: 인터넷쇼핑몰운영자
  mapping_type: broad
  confidence: high
  rationale: "온라인 판매채널 운영이라는 업무 범위가 정확히 부합."
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
job_code: j051
project_job_title: 영업지원 사무
official_mapping:
  code: K000003787
  title: 영업지원사무원
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j052
project_job_title: B2B 영업 보조
official_mapping:
  code: K000003787
  title: 영업지원사무원
  mapping_type: broad
  confidence: medium
  rationale: "현장영업원의 유통·실적·서류 등 지원업무 정의가 B2B 영업지원 업무와 부합 (j051과 동일 코드, 별도 기록)."
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
job_code: j054
project_job_title: 프론트 데스크 담당
official_mapping:
  code: K000006870
  title: 호텔프런트사무원
  mapping_type: exact_ish
  confidence: high
  rationale: "'프론트 데스크'와 '호텔프런트' 명칭이 정확히 대응."
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
job_code: j055
project_job_title: 병원 코디네이터 보조
official_mapping:
  code: K000001694
  title: 병원코디네이터
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j056
project_job_title: 접수·예약 담당
official_mapping:
  code: K000005000
  title: 예약접수원
  mapping_type: exact_ish
  confidence: high
  rationale: "명칭이 정확히 일치 (j048과 동일 코드, 별도 기록)."
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
job_code: j057
project_job_title: 전시장 안내 스태프
official_mapping:
  code: K000006841
  title: 공연장안내원
  mapping_type: broad
  confidence: medium
  rationale: "검표·안내·질서유지·관람객 불편해결이라는 정의가 전시장 안내 업무와 근접."
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
job_code: j058
project_job_title: 교육운영 매니저 보조
official_mapping:
  code: K000002421
  title: 교육훈련사무원
  mapping_type: broad
  confidence: medium
  rationale: "교육 프로그램 운영지원 업무가 교육훈련사무원 정의와 부합 (j021과 동일 코드, 별도 기록)."
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
job_code: j062
project_job_title: 카드뉴스 디자이너
official_mapping:
  code: K000001974
  title: 인포그래픽디자이너
  mapping_type: broad
  confidence: high
  rationale: "통계·문서자료를 효과적 디자인으로 시각화한다는 정의가 카드뉴스 제작 업무와 정확히 부합."
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
job_code: j064
project_job_title: 웹디자인 보조
official_mapping:
  code: K000007463
  title: 웹디자이너
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
education_requirement:
  value: "전문대졸 이상 — 디자인/멀티미디어/컴퓨터그래픽 관련 전공 또는 전문교육기관 훈련, 포트폴리오 중요"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 40000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2025
certifications:
  - name: "웹디자인기능사(국가기술)"
    tier: related
  - name: "컴퓨터그래픽스운용기능사(국가기술)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j066
project_job_title: 상품촬영·편집 보조
official_mapping:
  code: K000006887
  title: 상업사진작가
  mapping_type: broad
  confidence: medium
  rationale: "광고용 인물/상품사진 촬영이라는 정의가 '상품촬영' 업무 핵심과 부합(편집 부분은 범위 밖)."
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
job_code: j070
project_job_title: 주니어 웹개발자
official_mapping:
  code: K000005999
  title: 웹프로그래머
  mapping_type: broad
  confidence: high
  rationale: "웹 프로그래밍 언어를 이용한 프로그램 설계·작성 정의가 웹개발자 업무와 부합(batch1 backend-developer 후보로도 검토된 항목)."
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
job_code: j072
project_job_title: 백엔드 개발 보조
official_mapping:
  code: K000002520
  title: 응용소프트웨어엔지니어
  mapping_type: broad
  confidence: medium
  rationale: "batch1 backend-developer.yaml과 동일 매핑 논리(팀 검수 승인 이력) 재사용 — 서버·비즈니스로직 개발 범위와 부합."
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
job_code: j073
project_job_title: 앱개발 보조
official_mapping:
  code: K000002346
  title: 애플리케이션엔지니어
  mapping_type: broad
  confidence: high
  rationale: "고객 요구에 맞는 애플리케이션 개발·유지관리 정의가 앱개발 업무와 부합."
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
job_code: j075
project_job_title: QA 테스터
official_mapping:
  code: K000005026
  title: 소프트웨어테스터
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j076
project_job_title: IT 헬프데스크
official_mapping:
  code: K000005144
  title: 컴퓨터하드웨어기술지원원
  mapping_type: broad
  confidence: high
  rationale: "프로그램 설치·시스템 최적화·운영 중 문제해결 기술지원 정의가 IT 헬프데스크 업무와 정확히 부합."
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
job_code: j077
project_job_title: 서비스 운영자
official_mapping:
  code: K000006839
  title: 컴퓨터운영관리자
  mapping_type: broad
  confidence: medium
  rationale: "컴퓨터·네트워크 운영을 위한 시스템 관리 정의가 서비스 운영 업무와 부합."
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
job_code: j078
project_job_title: 기술지원 담당
official_mapping:
  code: K000002106
  title: 컴퓨터시스템관리원
  mapping_type: broad
  confidence: medium
  rationale: "정보시스템 안정적 관리·운영, 성능 최적상태 유지 정의가 기술지원 업무(장애대응 포함)와 부합."
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
job_code: j080
project_job_title: 입출고 담당
official_mapping:
  code: K000005061
  title: 창고작업원(일반)
  mapping_type: broad
  confidence: high
  rationale: "입고 물품 분류적재·출고 선별포장·재고관리 정의가 입출고 담당 업무와 정확히 부합."
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
job_code: j083
project_job_title: 창고 재고관리 담당
official_mapping:
  code: K000002383
  title: 물류관리사무원
  mapping_type: broad
  confidence: medium
  rationale: "입고 검수·적정 재고상태 유지 정의가 창고 재고관리 업무와 부합 (j015/j018과 동일 코드, 별도 기록)."
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
job_code: j085
project_job_title: 품질검사 보조
official_mapping:
  code: K000003540
  title: 품질관리사무원(일반)
  mapping_type: broad
  confidence: high
  rationale: "자재구매~생산 전과정의 품질개선·규격표준화 계획·운영·감독 정의가 품질검사 업무와 부합."
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
job_code: j086
project_job_title: 포장 작업자
official_mapping:
  code: K000003797
  title: 수동포장원(일반)
  mapping_type: broad
  confidence: medium
  rationale: "완제품을 포장지·박스에 담아 포장한다는 정의가 포장 작업자 업무와 부합(기계포장원 K000007226은 기계조작 특화라 제외)."
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
job_code: j087
project_job_title: 부품검수 보조
official_mapping:
  code: K000003610
  title: 자재검수원
  mapping_type: exact_ish
  confidence: high
  rationale: "원자재·부자재 입고 시 합격/불합격 판정 정의가 부품검수 업무와 정확히 부합."
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
job_code: j088
project_job_title: 조리보조
official_mapping:
  code: K000005093
  title: 조리사보조원
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
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
job_code: j091
project_job_title: 객실관리 보조
official_mapping:
  code: K000002179
  title: 호텔객실청소원
  mapping_type: broad
  confidence: high
  rationale: "객실 침구·욕실·바닥·비품 청소·정돈 정의가 객실관리 업무와 부합."
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
job_code: j092
project_job_title: 청소관리 작업자
official_mapping:
  code: K000003659
  title: 일반청소원
  mapping_type: broad
  confidence: high
  rationale: "사무실·건물 등의 내외부 청소 정의가 청소관리 작업 업무와 부합."
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
job_code: j095
project_job_title: 전기점검 보조
official_mapping:
  code: K000003281
  title: 전기안전관리원
  mapping_type: exact_ish
  confidence: high
  rationale: "송변전·배전설비 안전검사·사고예방대책 수립 정의가 전기점검 업무와 부합."
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
job_code: j098
project_job_title: 경비·보안 요원
official_mapping:
  code: K000007575
  title: 경비원
  mapping_type: exact_title
  confidence: high
  rationale: "명칭이 정확히 일치."
education_requirement:
  value: "특별한 학력·교육훈련 요건 없음"
  source_field: needKnwgCn
  evidence_type: descriptive_text
salary:
  entry_level: { min_krw: null, max_krw: null }
  reference_statistics:
    median_annual_krw: 24000000
    statistic_type: median
    population: "재직자 약 30명 설문조사"
    reference_year: 2023
certifications:
  - name: "일반경비지도사(국가전문)"
    tier: related
research_status: partial
status: provisional
missing_fields: []
```

```yaml
job_code: j100
project_job_title: 환경안전 보조
official_mapping:
  code: K000005321
  title: 건설안전관리원
  mapping_type: broad
  confidence: high
  rationale: "건설현장 작업원 안전·재해예방·설비 안전관리 정의가 환경안전 보조 업무와 부합."
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
job_code: j101
project_job_title: 배송운전 보조
official_mapping:
  code: K000005047
  title: 화물차운전원(일반)
  mapping_type: broad
  confidence: high
  rationale: "화물 목적지 운송, 적재·하역, 차량점검 등 정의가 배송운전 업무와 부합."
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
job_code: j102
project_job_title: 운반·하역 작업자
official_mapping:
  code: K000004943
  title: 하역원
  mapping_type: exact_ish
  confidence: high
  rationale: "원료·제품의 선박·부두·화물차·열차·항공기 적재·하역 정의가 운반·하역 작업 업무와 부합."
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

---

## B. 팀 검수 대상 (39건) — 확정하지 않음

```yaml
job_code: j014
project_job_title: 견적비교 담당
search_terms_tried: [견적사무원, 구매사무원, 자재구매사무원]
candidates:
  - official_code: K000006768
    official_title: 자재구매사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "구매정보 파악·구매계획 수립·자재구매라는 정의는 있으나 '견적 비교' 자체를 특화한 항목이 아님. 사전에 '견적사무원' 독립 항목이 없어 유일하게 근접한 후보이나 신뢰도 낮음."
selected_candidate: null
manual_review_required: true
note: "후보가 1개뿐이지만 업무범위 정합성이 낮아(구매 전체 프로세스 vs 견적비교 단일업무) 팀 판단 필요."
status: team_review
```

```yaml
job_code: j016
project_job_title: 수출입서류 보조
search_terms_tried: [수출입사무원, 무역사무원, 관세사무원, 통관사무원]
candidates:
  - official_code: K000005138
    official_title: 관세사무원
    mapping_type: broad
    confidence: medium
    priority: 1
    rationale: "'관세사의 지휘하에 수출입통관·환급 등 관련서류 작성·신청'이라는 정의가 '서류 보조' 역할과 근접."
  - official_code: K000003293
    official_title: 통관사무원
    mapping_type: broad
    confidence: medium
    priority: 2
    rationale: "'통관계획 입안 및 통관진행 제반업무·사후관리'라는 정의로 서류대조보다 통관 프로세스 전반에 가까움."
selected_candidate: null
manual_review_required: true
note: "두 후보 모두 타당성 있어 우선순위를 가리기 어려움 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j017
project_job_title: 운송·배차 보조
search_terms_tried: [운송사무원, 배차원, 배차사무원]
candidates:
  - official_code: K000003714
    official_title: 화물차배차원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "화물차량 배차·운행통제 정의로 일반 화물배차 업무에 가장 근접."
  - official_code: K000003996
    official_title: 버스배차원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "차량 배차 정의는 유사하나 여객(버스) 특화."
  - official_code: K000005337
    official_title: 컨테이너장비배차원
    mapping_type: broad
    confidence: low
    priority: 3
    rationale: "차량 배차 정의는 유사하나 컨테이너 장비 특화."
selected_candidate: null
manual_review_required: true
note: "사전에 '배차원' 범용 항목이 없고 전부 차종별 특화 항목뿐 — 어느 차종 기준인지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j022
project_job_title: 인사총무 보조
search_terms_tried: [총무사무원, 인사총무사무원, 인사담당자]
candidates:
  - official_code: K000007517
    official_title: 총무사무원
    mapping_type: broad
    confidence: medium
    priority: 1
    rationale: "물적자원(자산·행사·사무환경) 관리 정의로 총무 절반은 부합하나 인사 업무는 다루지 않음."
  - official_code: K000006752
    official_title: 총무인사관리자
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "인사+총무를 모두 포괄하나 '관리자'급 정의라 '보조' 직급과 불일치."
selected_candidate: null
manual_review_required: true
note: "'인사총무'를 동시에 다루는 사무직급 항목이 없어(사무원=총무만/관리자=인사+총무) 직급·범위 트레이드오프 판단 필요."
status: team_review
```

```yaml
job_code: j028
project_job_title: 시장조사 보조
search_terms_tried: [시장조사원, 설문조사원, 리서치어시스턴트]
candidates:
  - official_code: K000003433
    official_title: 시장조사분석가
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "시장규모·경쟁사 등 조사·분석 정의는 부합하나 요구학력이 대학원 이상으로 '보조' 직무와 격차가 큼."
  - official_code: K000004040
    official_title: 설문조사원
    mapping_type: broad
    confidence: medium
    priority: 2
    rationale: "고졸 정도로 눈높이는 맞으나 업무가 방문 설문지 기록에 국한돼 '시장조사 보조'의 데이터 수집·정제 범위보다 좁음."
selected_candidate: null
manual_review_required: true
note: "학력수준(분석가)과 업무범위(설문조사원) 중 어느 쪽을 우선할지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j029
project_job_title: CRM마케팅 운영
search_terms_tried: [CRM매니저, 고객관계관리자, 마케팅사무원]
candidates:
  - official_code: K000005116
    official_title: 마케팅사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "마케팅전략 기획·성과분석 정의는 있으나 CRM 특화 항목 아님, 상세데이터 공백."
  - official_code: K000001069
    official_title: 광고·홍보·마케팅사무원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "j025에서 이미 사용한 코드로 CRM 특화가 아니며 중복 매핑 시 근거가 약함."
selected_candidate: null
manual_review_required: true
note: "'CRM매니저'/'CRM마케팅' 독립 항목이 사전에 없음 — 마케팅사무원 계열 중 어느 것을 채택할지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j031
project_job_title: 블로그·뉴스레터 운영자
search_terms_tried: [블로그운영자, 뉴스레터에디터]
candidates:
  - official_code: K000007079
    official_title: 소셜미디어전문가
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "소셜미디어 계정 기획·운영·콘텐츠 관리 정의는 있으나 '블로그·뉴스레터'라는 특정 채널 특화는 아님."
selected_candidate: null
manual_review_required: true
note: "후보가 1개뿐이며 채널 범위가 프로젝트 직무보다 넓음(SNS 전반) — 채택 여부 팀 판단 필요."
status: team_review
```

```yaml
job_code: j032
project_job_title: 커뮤니티 운영 보조
search_terms_tried: [온라인커뮤니티운영자, 커뮤니티매니저]
candidates:
  - official_code: K000007032
    official_title: MCN크리에이터커뮤니티매니저
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "'1인 창작자를 도와 채널에 동영상 업로드, 시청자와 소통'이라는 정의로 범위가 MCN 채널 운영으로 좁아 일반 온라인 커뮤니티 모니터링·신고처리 업무와 결이 다름."
selected_candidate: null
manual_review_required: true
note: "명칭은 근접하나 실제 정의 범위가 프로젝트 직무(커뮤니티 모니터링/신고처리)와 상당히 달라 팀 판단 필요."
status: team_review
```

```yaml
job_code: j033
project_job_title: 콘텐츠 캘린더 담당
search_terms_tried: [콘텐츠운영자, 웹콘텐츠기획자]
candidates: []
selected_candidate: null
manual_review_required: true
note: "검색·상세 조회 모두 유의미한 후보를 찾지 못함(콘텐츠 캘린더/편집일정 관리라는 특화 업무의 독립 공식 항목 없음)."
status: team_review
```

```yaml
job_code: j034
project_job_title: 서비스기획 보조
search_terms_tried: [서비스기획자, 기획사무원]
candidates:
  - official_code: K000007119
    official_title: 클라우드서비스기획자
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "'서비스기획자' 검색은 89건 전부 산업 특화 복합명(클라우드/AI/헬스케어 등)뿐 — 범용 서비스기획자 항목 자체가 없음."
  - official_code: K000007783
    official_title: 인공지능서비스기획자
    mapping_type: related
    confidence: low
    priority: 2
    rationale: "위와 동일 사유의 대안 후보."
selected_candidate: null
manual_review_required: true
note: "범용 '서비스기획자' 항목이 사전에 없어 특정 산업 특화 항목 중 하나를 억지로 채택해야 하는 상황 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j036
project_job_title: 프로젝트관리 보조
search_terms_tried: [프로젝트관리자, PM]
candidates:
  - official_code: K000001910
    official_title: IT프로젝트매니저
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "프로젝트관리 정의는 있으나 IT 산업 특화 항목이라 일반 프로젝트관리 보조 업무보다 범위가 좁음."
selected_candidate: null
manual_review_required: true
note: "범용 '프로젝트관리자' 항목이 없고 IT 특화 항목만 존재 — 업종 한정 여부 팀 판단 필요."
status: team_review
```

```yaml
job_code: j038
project_job_title: 사업기획 보조
search_terms_tried: [사업기획자, 경영기획자]
candidates:
  - official_code: K000007433
    official_title: 프로덕트매니저(일반)
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "'(일반)' 표기가 있으나 제품(Product) 기획에 특화돼 사업 전반 기획과는 결이 다를 수 있음."
  - official_code: K000005776
    official_title: 제품기획자(일반)
    mapping_type: related
    confidence: low
    priority: 2
    rationale: "위와 유사한 사유의 대안 후보."
selected_candidate: null
manual_review_required: true
note: "범용 '사업기획자' 항목이 없음 — 제품기획 계열로 대체할지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j040
project_job_title: CRM 운영자
search_terms_tried: [CRM매니저, 고객관계관리자]
candidates:
  - official_code: K000005116
    official_title: 마케팅사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j029와 동일 사유."
  - official_code: K000001069
    official_title: 광고·홍보·마케팅사무원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "j025와 중복 매핑 우려."
selected_candidate: null
manual_review_required: true
note: "j029(CRM마케팅 운영)와 동일한 쟁점 — 두 직무를 동일 코드로 볼지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j043
project_job_title: 대시보드 운영 보조
search_terms_tried: [대시보드운영자]
candidates:
  - official_code: K000004005
    official_title: 데이터분석가(일반)
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "j039에서 이미 사용한 코드 — 대시보드 운영이라는 특화 업무와는 범위가 다름(데이터분석가는 분석·평가 중심)."
selected_candidate: null
manual_review_required: true
note: "검색 0건이며 대안 후보도 j039와 중복돼 신뢰도 낮음 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j046
project_job_title: 고객지원 매니저 보조
search_terms_tried: [고객경험매니저, 고객성공매니저, 컨텍센터매니저, 컨텍센터운영관리자]
candidates:
  - official_code: K000004177
    official_title: 컨텍센터상담원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "실무 상담원 정의라 '매니저 보조'가 시사하는 관리지원 성격·직급과 불일치. '컨텍센터매니저'/'컨텍센터운영관리자' 검색은 모두 0건."
selected_candidate: null
manual_review_required: true
note: "직급(매니저 보조 vs 실무상담원) 불일치가 뚜렷 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j047
project_job_title: 클레임 처리 보조
search_terms_tried: [클레임처리원, 고객불만처리원, 클레임관리자, 고객보상담당자]
candidates:
  - official_code: K000004177
    official_title: 컨텍센터상담원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "고객상담·클레임 대응 정의를 포괄할 수 있으나 클레임 처리 특화 항목은 아님. 나머지 검색어는 모두 무관한 결과(세라믹재료품질관리원 등 노이즈)만 반환."
selected_candidate: null
manual_review_required: true
note: "클레임 처리 특화 공식 항목이 없어 신뢰도 낮은 대체 후보뿐 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j053
project_job_title: 렌탈·구독 상담 보조
search_terms_tried: [렌탈상담원, 구독서비스상담원]
candidates:
  - official_code: K000005042
    official_title: 리스사무원
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "장비/차량 리스 계약사무 중심 정의로 소비자 대상 렌탈·구독 상담 업무와 결이 다름."
selected_candidate: null
manual_review_required: true
note: "검색 0건이며 유일 대안도 업무 성격이 상이(B2B 리스 사무 vs B2C 구독 상담) — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j059
project_job_title: 학습상담 보조
search_terms_tried: [학습상담사, 진학상담원, 학습컨설턴트, 진로진학상담교사]
candidates: []
selected_candidate: null
manual_review_required: true
note: "검색·대안 키워드 모두 0건 또는 무관 — 유의미한 후보를 찾지 못함."
status: team_review
```

```yaml
job_code: j060
project_job_title: 강의운영 보조
search_terms_tried: [학원강의보조, 강의보조원, 수업보조원, 티칭어시스턴트]
candidates:
  - official_code: K000006121
    official_title: 보습학원강사
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "강사 본인의 수업 진행 업무로, '강의운영 보조'(환경구축·출석관리·교재준비 등 지원업무)와 역할이 다름."
selected_candidate: null
manual_review_required: true
note: "강사 본인 역할과 강의 운영 지원 역할이 명확히 구분되는데 사전에 후자에 해당하는 독립 항목이 없음 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j061
project_job_title: 튜터·멘토 운영 보조
search_terms_tried: [멘토, 튜터]
candidates:
  - official_code: K000007174
    official_title: 온라인튜터
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "튜터 본인의 교습 업무로, '튜터·멘토 운영 보조'(튜터 선발·매칭·관리 지원)와 역할이 다름."
selected_candidate: null
manual_review_required: true
note: "j060과 동일한 쟁점(수행자 역할 vs 운영지원 역할 불일치) — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j063
project_job_title: 영상편집자 보조
search_terms_tried: [영상편집자, 동영상편집자, 영상편집기사, 동영상편집기사, 편집기사]
candidates:
  - official_code: K000002152
    official_title: 영화편집기사
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "영상 편집 정의는 부합하나 영화 산업 특화."
  - official_code: K000003236
    official_title: 방송편집기사
    mapping_type: related
    confidence: low
    priority: 2
    rationale: "영상 편집 정의는 부합하나 방송 산업 특화."
  - official_code: K000006997
    official_title: 영상편집기자
    mapping_type: related
    confidence: low
    priority: 3
    rationale: "영상 편집 정의는 부합하나 뉴스/보도 특화 뉘앙스."
selected_candidate: null
manual_review_required: true
note: "웹·소셜 콘텐츠 영상편집에 특화된 범용 항목이 없고 모두 특정 매체(영화/방송/보도) 특화 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j065
project_job_title: 썸네일 디자이너
search_terms_tried: [썸네일제작자, 유튜브썸네일디자이너]
candidates:
  - official_code: K000001974
    official_title: 인포그래픽디자이너
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "j062에서 이미 사용한 코드 — 통계/문서 시각화가 정의 핵심이라 '썸네일'(클릭 유도용 영상 표지 이미지) 특화 업무와는 다소 거리가 있음."
selected_candidate: null
manual_review_required: true
note: "검색 0건이며 대안 후보도 j062와 중복돼 신뢰도 낮음 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j067
project_job_title: 웹콘텐츠 운영자
search_terms_tried: [웹콘텐츠기획자, 콘텐츠운영자, 콘텐츠관리원, 홈페이지콘텐츠관리자]
candidates:
  - official_code: K000004884
    official_title: 콘텐츠관리원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "'주전산기 입력 정보 정리분석, 신규서비스 제공 위한 자료개발관리'라는 2014년 조사 정의로 통신사 전산자료 관리 성격이 강해, 현대적 의미의 웹콘텐츠 운영과는 결이 다를 수 있음."
selected_candidate: null
manual_review_required: true
note: "명칭은 근접하나 조사 시점(2014)과 정의 뉘앙스가 구식이라 현재 업무와 부합 여부 불확실 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j068
project_job_title: CMS 운영 보조
search_terms_tried: [콘텐츠관리원, 온라인콘텐츠관리자]
candidates:
  - official_code: K000004884
    official_title: 콘텐츠관리원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j067과 동일 사유."
selected_candidate: null
manual_review_required: true
note: "j067(웹콘텐츠 운영자)과 동일한 쟁점 — 동일 코드를 CMS 운영에도 적용할지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j069
project_job_title: 게시판·공지 관리 담당
search_terms_tried: [게시판관리자, 게시판운영자, 온라인모니터링요원]
candidates:
  - official_code: K000004884
    official_title: 콘텐츠관리원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j067/j068과 동일 사유 — 게시판·공지 관리 특화 항목은 아님."
selected_candidate: null
manual_review_required: true
note: "게시판·공지 관리에 특화된 독립 항목이 없어 콘텐츠관리원으로 3개 직무(j067~j069)를 동일하게 대체하는 것이 타당한지 팀 판단 필요."
status: team_review
```

```yaml
job_code: j071
project_job_title: 프론트엔드 개발 보조
search_terms_tried: [프론트엔드개발자, 웹개발자, 웹퍼블리셔]
candidates:
  - official_code: K000007016
    official_title: 웹퍼블리셔
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "HTML/CSS/JS를 활용한 웹화면 구현 정의가 있으나 '웹 표준·마크업' 중심이라 API 연동을 포함하는 현대적 프론트엔드 개발 범위보다 좁을 수 있음."
  - official_code: K000005999
    official_title: 웹프로그래머
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "j070(주니어 웹개발자)에서 이미 사용한 코드 — 백엔드/풀스택 포함 범용 정의라 프론트엔드 특화 여부가 불분명."
selected_candidate: null
manual_review_required: true
note: "마크업 특화(웹퍼블리셔) vs 범용 프로그래밍(웹프로그래머, j070과 중복) 사이에서 팀 판단 필요."
status: team_review
```

```yaml
job_code: j074
project_job_title: 소프트웨어 유지보수 보조
search_terms_tried: [유지보수엔지니어, 시스템엔지니어, 시스템소프트웨어엔지니어]
candidates:
  - official_code: K000004139
    official_title: 시스템소프트웨어엔지니어
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "'시스템소프트웨어를 개발한다'는 정의로 신규 개발 중심 뉘앙스라, 배포 후 결함수정·장애대응 중심인 '유지보수'와는 결이 다를 수 있음."
  - official_code: K000002106
    official_title: 컴퓨터시스템관리원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "j078(기술지원 담당)에서 이미 사용한 코드 — 시스템 운영·관리 정의가 유지보수와 더 가까울 수 있으나 중복 매핑 우려."
selected_candidate: null
manual_review_required: true
note: "'유지보수' 특화 항목이 사전에 없어 개발중심(시스템소프트웨어엔지니어) vs 운영중심(컴퓨터시스템관리원, j078과 중복) 사이 팀 판단 필요."
status: team_review
```

```yaml
job_code: j079
project_job_title: 계정·권한 관리 보조
search_terms_tried: [정보보호컨설턴트, 보안관리자]
candidates:
  - official_code: K000004565
    official_title: 정보보호컨설턴트
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "정보보호 취약점 분석·해결책 제안이라는 정의는 있으나 '컨설턴트'급 정의라 '보조' 직무와 직급 불일치."
selected_candidate: null
manual_review_required: true
note: "계정·권한관리라는 실무형 업무에 맞는 항목이 없고 컨설턴트급 항목만 존재 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j081
project_job_title: 피킹·패킹 작업자
search_terms_tried: [피킹원, 패킹원, 출고피킹원]
candidates:
  - official_code: K000005061
    official_title: 창고작업원(일반)
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j080(입출고 담당)에서 이미 사용한 코드 — 피킹·패킹 특화 항목이 없어 상위 범주인 창고작업원으로만 대체 가능."
selected_candidate: null
manual_review_required: true
note: "피킹/패킹 특화 독립 항목이 사전에 없고 대안도 j080과 중복 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j082
project_job_title: 물류분류 작업자
search_terms_tried: [물류분류원, 택배분류원, 자동분류기조작원, 컨베이어조작원]
candidates:
  - official_code: K000005061
    official_title: 창고작업원(일반)
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j080/j081과 동일 사유 — 분류작업 특화 항목이 없음."
selected_candidate: null
manual_review_required: true
note: "자동분류기/컨베이어 관련 검색은 모두 무관한 결과만 반환 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j084
project_job_title: 생산조립 작업자
search_terms_tried: [조립원, 조립원(일반), 기계조립원, 생산직조립원]
candidates: []
selected_candidate: null
manual_review_required: true
note: "'조립원(일반)'/'생산직조립원' 검색은 0건이며, '조립원'/'기계조립원' 검색 결과는 모두 특정 제품(가전/자동차부품 등) 특화 항목뿐 — 유의미한 범용 후보를 찾지 못함."
status: team_review
```

```yaml
job_code: j089
project_job_title: 식품제조 보조
search_terms_tried: [식품제조원, 식품제조원(일반), 식품생산직원, 가공식품제조원]
candidates: []
selected_candidate: null
manual_review_required: true
note: "'식품제조원(일반)' 등은 0건, '식품제조원' 검색 결과도 냉동건조커피제조원 등 특정 품목 특화 항목뿐 — 유의미한 범용 후보를 찾지 못함."
status: team_review
```

```yaml
job_code: j090
project_job_title: 식자재 준비 담당
search_terms_tried: [식자재관리원, 주방식자재관리원, 식재료관리원]
candidates: []
selected_candidate: null
manual_review_required: true
note: "모든 검색어 0건 — 유의미한 후보를 찾지 못함."
status: team_review
```

```yaml
job_code: j093
project_job_title: 비품보충 담당
search_terms_tried: [비품관리원, 소모품관리원]
candidates:
  - official_code: K000007517
    official_title: 총무사무원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "자산 매입·처분 등 물적자원 관리 정의에 비품 관리가 포함될 수 있으나, '보충' 실무작업보다는 총무 사무 전반에 가까움."
selected_candidate: null
manual_review_required: true
note: "'비품관리원'/'소모품관리원' 검색 결과는 모두 무관한 특정 산업 항목뿐 — 대안으로 총무사무원을 검토했으나 업무 성격 차이가 있어 팀 판단 필요."
status: team_review
```

```yaml
job_code: j094
project_job_title: 시설관리 보조
search_terms_tried: [시설관리원, 건물관리원, 부동산시설물관리원, 종합시설관리원]
candidates:
  - official_code: K000004857
    official_title: 부동산시설물관리원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "시설물 하자접수·보수 관리 정의는 있으나 전기/공조/보일러 등 구체적 설비 점검 업무는 다루지 않음."
  - official_code: K000003477
    official_title: 보일러조작원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "보일러 설비는 다루나 전기·공조는 범위 밖."
  - official_code: K000003281
    official_title: 전기안전관리원
    mapping_type: broad
    confidence: low
    priority: 3
    rationale: "전기 설비는 다루나(j095에서 사용) 공조·보일러는 범위 밖."
selected_candidate: null
manual_review_required: true
note: "'전기, 공조, 보일러 등' 여러 설비를 아우르는 범용 시설관리 항목이 없고 설비별 특화 항목만 존재 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j096
project_job_title: 공조·보일러 관리 보조
search_terms_tried: [보일러조작원, 공조설비관리원, 냉동냉장설비관리원, 냉동공조설비수리원]
candidates:
  - official_code: K000003477
    official_title: 보일러조작원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "보일러 조작·운영 정의는 부합하나 공조기·차량/기계장비 유압온도 측정 등 나머지 업무 범위는 다루지 않음."
selected_candidate: null
manual_review_required: true
note: "보일러 외 업무(공조기, 차량/기계장비 점검)를 포괄하는 항목이 없어 부분 매핑만 가능 — 팀 판단 필요."
status: team_review
```

```yaml
job_code: j097
project_job_title: 통신장비 설치 보조
search_terms_tried: [통신장비설치수리원, 통신장비설치원, 드론정비사, 무인비행장치정비원]
candidates:
  - official_code: K000005522
    official_title: 드론수리원
    mapping_type: related
    confidence: low
    priority: 1
    rationale: "직무 설명(촬영·방제용 드론의 배선·배터리·모터구동 점검)과는 정확히 일치하나, 프로젝트 직무명 '통신장비 설치 보조'와는 상충."
  - official_code: K000003586
    official_title: 통신장비설치원
    mapping_type: related
    confidence: low
    priority: 2
    rationale: "프로젝트 직무명과는 부합하나(통신장비 설치) 실제 설명(드론 정비)과는 상충."
selected_candidate: null
manual_review_required: true
note: "프로젝트 직무명과 설명(description)이 서로 다른 대상(통신장비 vs 드론)을 가리키는 것으로 보여, 원본 데이터 자체의 제목/설명 불일치 가능성을 포함해 팀 판단 필요."
status: team_review
```

```yaml
job_code: j099
project_job_title: 소방점검 보조
search_terms_tried: [소방관, 소방설비기술자]
candidates:
  - official_code: K000007495
    official_title: 소방관
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "직무 설명(화재진압·인명구조·소방장비관리·출동)과는 정확히 일치하나, 프로젝트 직무명 '소방점검 보조'(점검·예방 위주 뉘앙스)와는 결이 다름."
selected_candidate: null
manual_review_required: true
note: "프로젝트 직무명(점검 보조)과 설명(현장 소방활동 전반)의 뉘앙스 차이가 뚜렷해 팀 판단 필요 — j097과 유사한 제목/설명 불일치 패턴."
status: team_review
```

```yaml
job_code: j103
project_job_title: 배차현장 지원
search_terms_tried: [배차원, 배차사무원, 화물차배차원]
candidates:
  - official_code: K000003714
    official_title: 화물차배차원
    mapping_type: broad
    confidence: low
    priority: 1
    rationale: "j017과 동일 사유 — 화물 배차 정의가 가장 근접."
  - official_code: K000003996
    official_title: 버스배차원
    mapping_type: broad
    confidence: low
    priority: 2
    rationale: "j017과 동일 사유의 대안."
selected_candidate: null
manual_review_required: true
note: "j017(운송·배차 보조)과 동일한 쟁점(차종별 특화 항목만 존재) — 팀 판단 필요."
status: team_review
```

---

## 방법론 재검증 메모

- **재현 시도**: `경리사무원` 검색 → UTF-8 인코딩 폼 데이터로
  `retrieveOccpSrchKwrdListData.do` 호출 시 `K000007466`이 최상위 결과로 정상
  반환됨을 재확인했다. 반대로 EUC-KR로 동일 키워드를 인코딩해 보내면
  `searchKeyword` 응답 필드 자체가 mojibake로 깨지고 `totalRecordCount=0`이
  반환된다 — 즉 배치1 문서의 "요청 인코딩 EUC-KR" 기록은 오류이며, 실제로는 UTF-8이
  맞다(정정).
- `K000007466` 상세 API(`retrieveOccpNvgtEdcData.do`/`retrieveOccpNvgtWageData.do`)
  호출 결과도 배치1 기준값(`avwgCnvAmt=3500`, 자격증 3종, `needKnwgCn` 원문)과
  정확히 일치함을 재확인 — 상세 API 방법론은 배치1과 동일하게 유효.
- 접근 차단(403 등)은 배치2 조사 과정에서 발생하지 않았다. work.go.kr 계열 API를
  별도로 호출하지 않았으므로 배치1에서 보고된 `jobDetailSalData.do` 403 이슈는
  배치2에서 재현·검증 대상이 아니었다.
- **상세 데이터 공백 비율이 배치1보다 높음**: YAML에 반영한 52건 중 실제 학력·임금
  데이터가 채워진 것은 4건(j025, j041, j064, j098)뿐이고 나머지 48건은 공식 코드는
  확인되나 `edcInfo`/`wageInfo` 필드가 전부 공백(`상세 API 공백`)이었다. 배치1(9건
  확정 중 provisional 5건)보다 실데이터 확보율이 낮은데, 이는 배치2 대상 직무가
  창고/물류/총무/고객상담 등 재직자 임금조사가 상대적으로 드물게 이뤄지는 사무·현장직
  비중이 높기 때문으로 추정된다. 조작이나 API 실패가 아니라 정상 응답(`success:true`)
  내 공백임을 개별 코드마다 확인했다(dtl_results.json/final_data.json 원본 응답
  기준 — 조사자 로컬 스크래치 파일, 저장소에는 포함하지 않음).
- **제목/설명 불일치 케이스 발견**: j097(통신장비 설치 보조)과 j099(소방점검 보조)는
  프로젝트 직무명과 실제 `description` 내용이 서로 다른 대상을 가리키는 것으로
  보인다(j097 제목은 "통신장비 설치"이나 설명은 드론 정비, j099 제목은 "점검 보조"이나
  설명은 현장 소방활동 전반). 이는 매핑 방법론의 한계가 아니라 원본 잡파일 데이터
  자체의 제목/설명 정합성 문제일 수 있어 팀 검수 시 함께 확인이 필요하다.

## 수집기 회귀 테스트에 반영할 케이스 (배치2 추가분)

1. **검색 API 인코딩(정정)**: `경리사무원` 검색 시 **UTF-8** 인코딩된 폼 데이터로
   요청해야 `konetOccpCd=K000007466`을 반환한다. EUC-KR로 보내면 키워드가 깨져
   `totalRecordCount=0`이 되는 회귀를 잡아야 한다 — 배치1 문서의 기록과 반대이므로
   collector 구현 시 반드시 UTF-8 기준으로 작성할 것.
2. **한국직업사전 상세 API 보조 활용**: `retrieveOccpDctnDtalData.do`
   (`konetOccpCd` 파라미터)는 `retrieveOccpNvgtEdcData.do`/`WageData.do`와는 별도
   서브시스템으로, `dtyCn`(직무개요 한 줄 요약)·`excDtyCn`(상세 직무내용)을
   제공한다. 이는 학력/임금 통계용이 아니라 **후보 간 업무 정의 대조용**으로만
   사용했다 — YAML의 `education_requirement`/`salary` 값 출처는 여전히
   `retrieveOccpNvgtEdcData.do`/`WageData.do`(`needKnwgCn`/`avwgCnvAmt` 등)로 한정.
3. **다수 코드가 상세 API 공백인 경우**: 배치2에서 확인된 상세 API 공백 코드 목록
   (예: K000002274, K000002383, K000001625, K000003735, K000002421, K000007413,
   K000003274, K000002314, K000001247, K000004998, K000004005, K000007166,
   K000004177, K000005000, K000008001, K000006507, K000003787, K000006870,
   K000001694, K000006841, K000006887, K000005999, K000002520, K000002346,
   K000005026, K000005144, K000006839, K000002106, K000005061, K000003540,
   K000003797, K000003610, K000005093, K000002179, K000003659, K000003281,
   K000005321, K000005047, K000004943)는 모두 `success:true`이면서 필드 전부
   공백/0/null — 향후 동일 코드 재조회 시 이 목록과 대조해 "API 실패"와 "정상
   공백"을 혼동하지 않도록 회귀 테스트에 포함한다.
