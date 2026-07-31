# 직업 데이터 리서치 브리프 — 급여 / 학력요건 / 자격증

GPT(웹 브라우징 가능한 모델)에게 그대로 붙여넣어 시키기 위한 지시문입니다.
목적: `data/jobs/*.yaml` 105개 직업에 급여·학력요건·자격증 필드를 추가하는데,
LLM의 "기억"이 아니라 실제 공식 출처를 찾아 인용과 함께 채워야 신뢰할 수 있습니다.

**v2 개정**: 최초 버전은 "재직자 평균/중위임금 → 신입 초임"으로 잘못 치환될
위험, 범위(최소~최대) 임의 생성 위험, "보조/담당" 류 직무가 공식 직업분류와
정확히 매칭되지 않는 문제, 필드별 출처가 뭉뚱그려지는 문제가 있어 아래 내용을
전면 반영해 개정했습니다.

---

## GPT에게 그대로 전달할 지시문

```
너는 한국 직업 정보 리서처야. 아래 105개 직업 각각에 대해 학력요건, 관련
자격증, 임금 정보를 조사해줘.

## 절대 규칙 (반드시 지켜)
1. 기억으로 답하지 말고 반드시 웹 검색으로 실제 페이지를 찾아서 그 페이지에 있는
   내용만 옮겨 적어. 검색으로 못 찾은 항목은 절대 추측하지 말고 null/미상으로 두고
   이유를 한 줄로 남겨. null이 정상적인 결과다 — 못 찾았다고 해서 그럴듯한 값을
   만들어내지 마.
2. 학력·자격증·급여는 각각 별도로 출처를 확인하고 각각의 출처(기관명+페이지명+URL+
   확인일)를 따로 기록해. 한 페이지에서 세 가지를 다 봤어도 필드마다 반복 기록해
   (어느 필드가 어느 출처에서 나왔는지 나중에 추적 가능해야 함).
3. 출처는 아래 우선순위로 사용해:
   1순위: 고용24/워크넷 직업정보 (work24.go.kr, work.go.kr)
   2순위: NCS 국가직무능력표준 (ncs.go.kr)
   3순위: 한국고용정보원 한국직업정보(KNOW, know.work24.go.kr)
   4순위: 통계청 임금구조통계, 지역별고용조사 (kostat.go.kr)
   5순위: 위 공식 출처에서 못 찾은 경우에만 — 사람인/잡코리아 등 채용플랫폼의
          "공개된 통계 페이지"(개별 채용공고 아님) — 이 경우 반드시
          "공식 통계 아님, 채용플랫폼 집계치"라고 표시
4. "실제 채용 관행"이라는 판단을 직업정보 페이지 한 곳만 보고 단정하지 마.
   페이지에 적힌 내용을 그대로 옮기고, 그게 법정 요건인지/직업정보상 진입경로
   설명인지/개별 우대조건 나열인지 구분해서 evidence_type에 표시해.

## 급여 조사 핵심 규칙 (가장 중요)
- 고용24·한국직업정보에서 확인한 평균임금, 중위임금, 하위 25% 임금 등은
  절대 "신입 초임"이라고 바꿔 쓰지 마. 그 통계가 재직자 전체 대상인지,
  경력별로 나뉘어 있는지 원문에 적힌 그대로 구분해.
- 출처에 신입/초임 수치가 명시적으로 있는 경우에만 salary.entry_level에 값을 채워.
- 재직자 전체 임금 통계만 있으면 salary.entry_level은 min_krw/max_krw 둘 다 null로
  두고, salary.reference_statistics에 있는 그대로(중위값/평균값 하나, 범위 아님)를 기록해.
- 출처에 범위(최소~최대)가 없으면 평균/중위 "단일값"을 범위로 임의 확장하지 마.
  단일값이면 단일값으로만 기록해.
- 해당 직업명이 공식 분류에 그대로 없으면(예: "OO 보조", "OO 담당" 같은 이 프로젝트
  자체 직무명) 아래 official_job_mapping을 반드시 채워서 어떤 상위/유사 공식
  직업으로 대체했는지, 왜 그렇게 판단했는지, 그 판단이 얼마나 확실한지(confidence:
  high/medium/low)를 남겨.

## 자격증 3단계 분류
- legally_required: 법령상 해당 업무를 하려면 반드시 있어야 하는 면허/자격
  (예: 특정 업종의 안전관리자 자격 등). 없으면 빈 리스트.
- commonly_preferred: 채용공고·직업정보에 "우대"로 명시된 자격.
- related: 공식 직업정보의 "관련 자격" 목록에는 있지만 채용 우대 여부까지는
  확인 안 된 자격. (related에는 있는데 실제 채용에서 요구되는지는 불명확할 수
  있음을 감안)

## 출력 형식 (직업당 1블록, 아래 YAML 구조 그대로)
job_code: <코드>
job_title: <직업명>

official_job_mapping:
  source_job_title: <실제로 검색해서 매칭한 공식 직업명>
  mapping_type: <exact | broader_occupation | related_occupation>
  confidence: <high | medium | low>
  rationale: <왜 이 매핑을 썼는지 한 줄>

education_requirement:
  value: <고졸 이상 / 전문대졸 이상 / 대졸 이상 / 무관 등>
  major: <관련 전공, 없으면 null>
  evidence_type: <legal_requirement | occupational_information | job_posting_aggregate>
  source:
    organization: <기관명>
    page_title: <페이지 제목>
    url: <실제 URL>
    accessed_at: <확인일 YYYY-MM-DD>
  note: <이 요건이 법정 필수인지 진입 관행 설명인지 등 한 줄>

certifications:
  legally_required: []
  commonly_preferred: []
  related: []
  items:
    - name: <자격증명>
      tier: <legally_required | commonly_preferred | related>
      legal_basis: <근거 법령, 없으면 null>
      source:
        organization: <기관명>
        url: <실제 URL>
        accessed_at: <확인일>

salary:
  entry_level:
    min_krw: <출처에 명시된 신입 초임 최소, 없으면 null>
    max_krw: <출처에 명시된 신입 초임 최대, 없으면 null>
    basis: <근거 설명, 못 찾았으면 "공식 출처에서 신입 초임 수치를 확인하지 못함">
  reference_statistics:
    value_krw: <중위값 또는 평균값 단일 수치, 없으면 null>
    statistic_type: <median | mean>
    population: <재직자 전체 / 경력 O년 이상 등>
    reference_year: <통계 기준 연도>
  source:
    organization: <기관명>
    page_title: <자료명>
    url: <실제 URL>
    accessed_at: <확인일>
  is_substitute: <official_job_mapping이 exact가 아니면 true>
  substitute_job_title: <대체해서 쓴 공식 직업명, exact면 null>

research_status: <complete | partial | not_found>
missing_fields: [<못 채운 필드 이름들, 없으면 빈 리스트>]
review_note: <이 직업 조사에서 특이사항이나 주의할 점 한 줄>

## 조사 대상 (job_code|job_title), 총 105개 — 아래 배치로 나눠 진행. 한 번에
다 하지 말고 배치 하나씩 완료 후 다음 배치로.
```

(위 지시문 뒤에 아래 "배치 목록"을 이어 붙여서 GPT에게 한 번에 하나씩 순서대로 시키면 됩니다.)

---

## 배치 목록 (10~15개씩, 총 8배치)

**배치 1**
```
backend-developer|백엔드 개발자
marketer|마케터
j001|사무보조원
j002|행정지원 담당
j003|총무 담당자
j004|문서관리 담당
j005|비품·자산관리 보조
j006|경리사무원
j007|회계보조
j008|정산 담당
j009|세금계산서 관리 보조
j010|급여정산 보조
j011|구매사무 보조
j012|발주관리 담당
```

**배치 2**
```
j013|자재관리 보조
j014|견적비교 담당
j015|물류사무원
j016|수출입서류 보조
j017|운송·배차 보조
j018|재고관리 사무
j019|출고관리 사무
j020|채용운영 보조
j021|교육운영 보조
j022|인사총무 보조
j023|근태관리 보조
j024|면접일정 조율 담당
j025|콘텐츠 마케터
j026|퍼포먼스마케팅 보조
```

**배치 3**
```
j027|브랜드홍보 보조
j028|시장조사 보조
j029|CRM마케팅 운영
j030|SNS 운영자
j031|블로그·뉴스레터 운영자
j032|커뮤니티 운영 보조
j033|콘텐츠 캘린더 담당
j034|서비스기획 보조
j035|상품기획·MD 보조
j036|프로젝트관리 보조
j037|행사·전시 운영 보조
j038|사업기획 보조
j039|데이터분석 보조
j040|CRM 운영자
```

**배치 4**
```
j041|매출 리포트 담당
j042|데이터 라벨링 관리
j043|대시보드 운영 보조
j044|인바운드 상담사
j045|온라인 CS 담당
j046|고객지원 매니저 보조
j047|클레임 처리 보조
j048|예약·접수 상담원
j049|매장 판매원
j050|온라인 판매 운영자
j051|영업지원 사무
j052|B2B 영업 보조
j053|렌탈·구독 상담 보조
j054|프론트 데스크 담당
```

**배치 5**
```
j055|병원 코디네이터 보조
j056|접수·예약 담당
j057|전시장 안내 스태프
j058|교육운영 매니저 보조
j059|학습상담 보조
j060|강의운영 보조
j061|튜터·멘토 운영 보조
j062|카드뉴스 디자이너
j063|영상편집자 보조
j064|웹디자인 보조
j065|썸네일 디자이너
j066|상품촬영·편집 보조
j067|웹콘텐츠 운영자
j068|CMS 운영 보조
```

**배치 6**
```
j069|게시판·공지 관리 담당
j070|주니어 웹개발자
j071|프론트엔드 개발 보조
j072|백엔드 개발 보조
j073|앱개발 보조
j074|소프트웨어 유지보수 보조
j075|QA 테스터
j076|IT 헬프데스크
j077|서비스 운영자
j078|기술지원 담당
j079|계정·권한 관리 보조
j080|입출고 담당
j081|피킹·패킹 작업자
j082|물류분류 작업자
```

**배치 7**
```
j083|창고 재고관리 담당
j084|생산조립 작업자
j085|품질검사 보조
j086|포장 작업자
j087|부품검수 보조
j088|조리보조
j089|식품제조 보조
j090|식자재 준비 담당
j091|객실관리 보조
j092|청소관리 작업자
j093|비품보충 담당
j094|시설관리 보조
j095|전기점검 보조
```

**배치 8**
```
j096|공조·보일러 관리 보조
j097|통신장비 설치 보조
j098|경비·보안 요원
j099|소방점검 보조
j100|환경안전 보조
j101|배송운전 보조
j102|운반·하역 작업자
j103|배차현장 지원
```

목록 검증: `data/jobs/*.yaml` 105개 파일에서 `code`/`title`을 직접 추출해
위 배치 목록과 diff 확인 완료 — 105개 전부 일치 (2026-07-13 기준).

---

## 예시 (j070 주니어 웹개발자 — 스키마 적용 샘플, 실제 조사 값 아님)

```yaml
job_code: j070
job_title: 주니어 웹개발자

official_job_mapping:
  source_job_title: 웹개발자
  mapping_type: broader_occupation
  confidence: medium
  rationale: 주니어 직급이 분리된 공식 직업정보를 찾지 못해 상위 직업으로 대체

education_requirement:
  value: 대졸 이상
  major: 컴퓨터·소프트웨어 관련 전공 우대
  evidence_type: occupational_information
  source:
    organization: 고용24
    page_title: 웹개발자 직업정보
    url: <실제 상세 페이지 URL>
    accessed_at: 2026-07-13
  note: 직업정보상 진입 경로이며 개별 기업의 필수 채용조건을 의미하지 않음

certifications:
  legally_required: []
  commonly_preferred: [정보처리기사]
  related: []
  items:
    - name: 정보처리기사
      tier: commonly_preferred
      legal_basis: null
      source:
        organization: 고용24
        url: <실제 상세 페이지 URL>
        accessed_at: 2026-07-13

salary:
  entry_level:
    min_krw: null
    max_krw: null
    basis: 공식 출처에서 신입 초임 범위를 확인하지 못함
  reference_statistics:
    value_krw: <실제 값>
    statistic_type: median
    population: 재직자 전체
    reference_year: 2025
  source:
    organization: 한국고용정보원
    page_title: <실제 자료명>
    url: <실제 URL>
    accessed_at: 2026-07-13
  is_substitute: true
  substitute_job_title: 웹개발자

research_status: partial
missing_fields: [entry_level_salary]
review_note: 신입 초임을 재직자 임금 통계로 대체하지 않았음
```

> 핵심 원칙: 공식적인 신입 초임 자료가 없으면 `null`이 정상 데이터다.
> 재직자 중위임금을 신입 초임 범위처럼 꾸며 넣는 것보다 훨씬 신뢰할 수 있다.

---

## 결과 회수 후 처리 방법 (내 작업, 참고용)

1. GPT가 배치별로 출력한 블록들을 그대로 텍스트 파일로 모아서 전달해주면 됨
   (형식 그대로 유지, 요약/재가공 없이).
2. 각 job_code의 `data/jobs/<code>.yaml`에 `education_requirement`,
   `certifications`, `salary` 필드를 추가.
3. 사용된 출처를 `docs/counseling/source_registry.md`와 동일한 형식으로 새
   레지스트리(`docs/jobs/source_registry.md`)에 등록 — 기관/자료명/URL/확인일/
   직접 복제 여부(사실 수치이므로 원문 인용 자체는 허용, 서술형 설명 문장만 자체
   표현으로).
4. `research_status: partial`이거나 `missing_fields`가 있는 항목은 그대로
   남겨두고 추후 보강 대상으로 별도 목록화 — 채워 넣지 않는다.
5. 이 작업(직업 메타데이터 보강)은 상담 프롬프트 데이터팩 작업과 성격이 달라서,
   실제로 `data/jobs/*.yaml`에 반영할 때는 별도 브랜치/PR로 분리하는 걸 권장
   (예: 브랜치 `feat/job-requirements-research`, PR 제목
   `data: 직업별 학력·자격·임금 근거 데이터 추가`). 다만 현재 세션은 `feature/MSJ`
   단일 브랜치로 작업 중이므로, 실제 반영 시점에 브랜치를 새로 팔지 여부는 그때
   다시 확인받는다.

## 참고: 이 리서치가 기존 anti-fabrication 원칙과 다른 점

`source_registry.md`의 "직접 복제 없음" 원칙은 심리검사 문항처럼 저작물성이 있는
콘텐츠에 적용되는 규칙입니다. 급여 수치·자격증 명칭·학력요건 같은 사실 데이터는
저작물이 아니라 객관적 사실이므로, 숫자·명칭 자체를 원문 그대로 옮기는 것은 문제
없습니다 — 다만 그 사실이 어느 공식 페이지에서 나왔는지, 그리고 그 통계가 정확히
무엇을 측정한 값인지(재직자 전체 vs 신입, 범위 vs 단일값)를 반드시 구분해서
남겨야 검증 가능하고, 나중에 오류가 발견됐을 때 추적할 수 있습니다.
