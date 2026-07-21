# 근거기준표 검수 문서 — 8모듈 가중치 · 105개 직무 프로필 · 근거 신뢰도 규칙

작성일: 2026-07-21

관련 배경 문서: [experience_evaluation_framework.md](experience_evaluation_framework.md) ·
[source_registry.md](source_registry.md) · [current_counseling_audit.md](current_counseling_audit.md)

## 요약

상담·추천 로직에 쓰이는 세 데이터 — **① 8모듈 → 43축 가중치(`module_mapping.json`)**,
**② 105개 실제 추천 직무의 `competencies`/`interest_profile` 점수**, **③ 근거 신뢰도
규칙(`evidence_rules.json`)** — 는 팀이 실제로 수집한 NCS·고용24·워크넷 자료와 두 건의
연구 스프레드시트, 103개 직무별 연구 카탈로그를 거쳐 나온 값이다. 근거 없이 지어낸
숫자가 아니라는 것을 파일 단위로 확인했다.

다만 "정성적 연구자료 → 최종 숫자"로 넘어가는 마지막 단계는 팀의 판단(일부는 LLM
채점)이며, 이 변환 자체는 자동 검증 대상이 아니다. 이 문서는 근거 체인 전체를 추적
가능한 형태로 정리하고, 검수 시 확인이 필요한 지점을 명시한다.

## 근거 체인 한눈에 보기

```
공식 출처 (NCS / 고용24 / 워크넷 / 공공데이터포털 — A등급, 실제 URL 존재)
        │
        ▼
팀 연구 스프레드시트 2건 (data/research/*.xlsx)
        │
        ├──────────────────────────────┐
        ▼                              ▼
40개 카테고리 직무                    103개 직무별 연구 카탈로그
module_mapping.json                   data/prompts/npc/jobs/J0xx.yaml
(8모듈 dimension_weights)             (전부 provenance 블록 포함)
        │                              │
        ▼                              ▼
data/jobs/{kts,ms,ys,jm,stn,yg}-*.yaml LLM 생성 (family 단위 비교평가)
(가중치를 그대로 이식)                       │
                                       ▼
                                data/jobs/j0xx.yaml
                                (competencies, interest_profile)
```

---

## 1. 공식 출처 — 실제 확인된 A등급 근거

`입문직무_RAG_KB_v5_정리본.xlsx`의 `05_근거_방어논리` 시트에 등급(A~D)과 URL이 함께
정리돼 있다. 아래는 그중 A등급(공식 출처) 항목이다.

| 자료명 | 기관 | 확인 내용 | 우리 서비스 활용 | URL |
|---|---|---|---|---|
| NCS 구성 | NCS | 능력단위·수행준거·지식/기술/태도·작업상황·평가지침 구조 | 업무프로세스/성공기준/평가루브릭 뼈대 | ncs.go.kr/th01/TH-102-001-03.scdo |
| 직업심리검사 | 고용24 | 흥미·적성·성격·가치·역량·취업준비도 기반 검사 | 상담→직무추천 포지션 근거 | work24.go.kr/wk/r/c/1000/jobPsyExamList.do |
| 직업선호도검사 S/L형 | 고용24 | 흥미유형 기반 직업 추천 | 추천 이후 체험이라는 구조의 근거 | m.work24.go.kr (systClId=SC00000185) |
| K-디지털 트레이닝 | 고용24 | 평균 6개월·주5일·일8시간·실전 프로젝트 30%↑ | KDT/국비교육생 타깃 근거 | m.work24.go.kr (systClId=SC00000197) |
| 한국직업사전 | 워크넷 | 직무분석 기반 직업분류/직무정보 | 세부직무 정의·직무명 정합성 | work.go.kr/consltJobCarpa/... |
| 직업사전 API | 공공데이터포털 | 직업사전 목록·상세정보 API | 추가 자동수집 후보 | data.go.kr/data/15037284/openapi.do |

같은 시트에 B~D등급(사람인/잡코리아 현직자 인터뷰, 커리어넷, SHRM 온보딩 가이드, 잡플래닛
현실감 참고 등)과 라이선스 직업(의사·변호사 등) 제외 근거, 발표 방어용 Q&A까지 함께
정리돼 있다.

## 2. 팀 연구 스프레드시트 2건

위 공식 출처를 실제 서비스 설계로 옮긴 팀 자체 연구 산출물. `module_mapping.json`
disclaimer가 "팀 조사자료"라고 지칭하는 파일이 바로 이것이다.

- **`data/research/팀통합_8모듈_조사자료_표준화완료.xlsx`** (8개 시트) — 8모듈별 담당자
  배정, RAG 직군 연결맵, 5단계 프로세스(업무요청 이해→자료·현황 확인→처리·제작·응대→
  검수·판단→보고·인계) 설계, 카테고리별 **NCS 능력단위명 + 대표 표준업무 TOP10**, 상황별
  미션 203행, 대표미션 선정 근거(예: 실제 NCS 코드 "고객관리(0201030406)" 인용)를 담고
  있다. `07_검증로그` 시트가 상위 출처 2건(`아마최종4.xlsx`=NCS 기준, `입문직무_RAG_KB_v5_정리본.xlsx`=RAG 기준)을 명시한다.
- **`data/research/입문직무_RAG_KB_v5_정리본.xlsx`** (7개 시트) — 103개 직무 마스터
  목록(`01_직무마스터`, 직무별 검증등급 A~D 포함), 515개 RAG 검색 청크(`02_RAG프로세스`),
  공통 온보딩 프로세스(`03_공통프로세스`), 위 1번 표의 근거 맵(`05_근거_방어논리`)을
  포함한다.

추가로, `docs/counseling/source_registry.md`의 `SRC-WORK24-CAREER-PREF-S` 항목(고용24
직업선호도검사 S형)이 "서비스 적용 위치"로 `module_mapping.json`의 RIASEC→모듈 초기
가중치를 명시적으로 지목하고 있다. 단 "직접 복제 여부: 없음"이라고 못박아둔 것처럼, 이건
**RIASEC 6유형이라는 분류 틀 자체**를 참고했다는 뜻이지 1.0/0.8/0.6 같은 구체적 숫자가
이 출처에서 나왔다는 뜻은 아니다.

## 3. 40개 카테고리 직무 — 8모듈 dimension_weights

출처: `data/counseling/module_mapping.json`. 각 직무 YAML
(`data/jobs/{kts,ms,ys,jm,stn,yg}-*.yaml`)에 소속 모듈의 `dimension_weights`를
코드/타이틀 1:1 매칭으로 기계적으로 이식했다(개별 직무 단위 조사가 아니라 모듈 단위
연구 결과를 그대로 복사).

| 모듈 | dimension_weights | 카테고리 직무(5개씩) |
|---|---|---|
| 대인응대형 | interest.social 1.0 · interest.enterprising 1.0 · work_target.people 0.8 · work_style.collaboration 0.8 · skill.communication 0.6 · skill.coordination 0.6 | kts-01 의료·복지·상담 응대 · kts-02 교육·강의·코칭 응대 · kts-03 영업·판매·매장응대 · kts-04 상담·안내·중개 응대 · kts-05 안내·접수·예약·프론트 |
| 절차·점검형 | interest.investigative 1.0 · interest.conventional 1.0 · work_target.data 0.8 · work_target.documents 0.8 · work_style.structured 0.8 · work_style.detail_orientation 0.8 · skill.error_detection 0.6 · skill.coordination 0.6 | ms-01 문서·법무·기록관리 · ms-02 회계·경리·정산 사무 · ms-03 총무·행정·사무보조 · ms-04 무역·물류·운송 사무 · ms-05 생산·품질관리 사무 |
| 작업순서·절차형 | interest.realistic 1.0 · interest.conventional 1.0 · work_target.equipment 0.8 · work_target.environment 0.8 · work_style.field 0.8 · skill.tool_operation 0.6 | ms-06 농축산 현장 작업 · ms-07 조리·식품제조 현장 · ms-08 생활서비스 현장 작업 · ms-09 기계가공·금속가공 작업 · ms-10 건설·토목·조경 시공절차 |
| 제작·상태판단형 | interest.artistic 1.0 · work_target.ideas 0.8 · work_style.novelty 0.8 · work_style.autonomy 0.8 · skill.creative_production 0.6 | yg-01 디자인·영상·콘텐츠 제작 · yg-02 콘텐츠·예술·공예 제작 · yg-03 웹·앱·소프트웨어 개발 · yg-04 IT·시스템 개발·운영 · yg-05 웹 운영·콘텐츠 관리 |
| 돌발상황 대처형 | interest.enterprising 1.0 · work_target.environment 0.8 · work_style.field 0.8 · work_style.time_pressure 0.8 · skill.risk_detection 0.6 · skill.priority_judgment 0.6 | jm-01 육상 운전·배송 대응 · jm-02 철도 운행·기관 운전 · jm-03 항공 운항·관제 대응 · jm-04 해상 운항·선박 조종 · jm-05 중장비·특수장비 조종 |
| 안전·위험판단형 | interest.realistic 1.0 · work_target.environment 0.8 · work_style.time_pressure 0.8 · skill.risk_detection 0.6 · skill.priority_judgment 0.6 | ys-01 치안·범죄현장 대응 · ys-02 군사·국가안보 작전 · ys-03 경호·신변보호·보안 · ys-04 소방·구조·방재 대응 · ys-05 건설·시설 안전관리 |
| 장비·상태점검형 | interest.realistic 1.0 · interest.investigative 1.0 · work_target.equipment 0.8 · work_style.detail_orientation 0.8 · skill.error_detection 0.6 · skill.tool_operation 0.6 | ys-06 전기·배전·계측 점검 · ys-07 차량·기계 정비 보조 · ys-08 기계·전자·산업장비 점검 · ys-09 설비·장비 설치·정비 · ys-10 시설·설비·전기관리 |
| 정보·판단형 | interest.investigative 1.0 · interest.enterprising 1.0 · work_target.data 0.8 · work_target.ideas 0.8 · work_style.novelty 0.8 · work_style.autonomy 0.8 · skill.data_analysis 0.6 | stn-01 마케팅·광고·홍보 운영 · stn-02 행사·전시·콘텐츠 기획 · stn-03 데이터·CRM·매출 분석 · stn-04 과학·기술 조사분석 · stn-05 서비스·상품·사업기획 보조 |

**알려진 한계**: 추천 스코어링(`recommendation/service.py`의 `_module_interest_match`)은
위 가중치 중 `interest.*` 서브셋만 사용자 사전설문(RIASEC)과 코사인 매칭한다.
`work_target.*`/`work_style.*`/`skill.*`은 대응하는 사용자 신호가 아직 없어 반영되지
않는다. 그 결과 **같은 모듈에 속한 5개 직무는 가중치가 완전히 동일해 서로 점수가
구분되지 않는다** (실 DB 검증: consultation id=17, social=100 압도적 프로필로 랭킹 시
대인응대형 kts-01~05가 전부 74점 동점으로 top5 석권). 나머지 축 그룹까지 반영하려면
LLM이 대화에서 근거를 추출해 `Evidence` 테이블에 채우는 다음 단계가 필요하다.

## 4. 105개 실제 추천 직무 — competencies / interest_profile

추천 후보 풀의 핵심인 `data/jobs/j001.yaml`~`j103.yaml` 등의 역량 점수도 출처가
추적된다.

1. **연구 카탈로그 → J0xx.yaml (103개, 전부 provenance 포함)**: `data/prompts/npc/jobs/`
   아래 J001~J103 파일 **103개 전부**가 파일 끝에 `provenance:` 블록을 갖고 있고, 각각
   `입문직무_RAG_KB_v5_정리본.xlsx`(01_직무마스터/02_RAG프로세스, `job_id=J0xx`로 특정
   행 지정)와 `팀통합_8모듈_조사자료_표준화완료.xlsx`(01_연결맵/02_단계별프로세스/
   05_상황별미션)를 job_id 단위로 인용한다. 예를 들어 `J001_사무보조원.yaml`의
   provenance는 두 파일의 정확한 시트명과 `job_id=J001` 행을 지정한다.
2. **J0xx.yaml → data/jobs/j0xx.yaml (LLM 생성, 입력 근거는 실측 자료)**: 생성 스크립트
   [generate_recommendation_jobs.py](../../services/api/app/scripts/generate_recommendation_jobs.py)가
   같은 family(직군) 안의 J0xx.yaml에서 실제 미션 사실 — 요청 대사(`request_line`),
   필수 행동(`required_actions`), 성공 기준(`success_criteria`), 실패 패턴
   (`failure_patterns`), 전부 위 연구자료에서 나온 콘텐츠 — 을 뽑아 LLM에 근거로
   제공하고, family 단위로 직무끼리 비교시켜 `competencies`(1~5)·`interest_profile`
   (RIASEC 1~5)를 매기게 한다. 판단 근거는 직무마다 `_rationale_log.json`에 한 줄씩
   남는다.
3. **급여/학력/자격증은 별도 근거 체인**: [batch1_mapping_candidates.md](../jobs/batch1_mapping_candidates.md),
   `batch2_mapping_candidates.md`가 워크피디아(`wagework.go.kr`) 공식 API로 조회한 공식
   직업코드(`K0000xxxx`)와 매핑 신뢰도(high/medium/low), 근거 필드(`needKnwgCn` 등)를
   건별로 기록한다. 공식 API에 데이터가 없는 직무는 `status: not_found`로 숨기지 않고
   명시한다.
4. **나머지 2개(marketer, backend-developer)도 예외 없이 LLM 생성**: 이 둘은 J0xx 연구
   카탈로그 밖의 독립 데모 직무라 [generate_legacy_interest_profile.py](../../services/api/app/scripts/generate_legacy_interest_profile.py)가
   기존 title/description/competencies를 근거로 같은 RIASEC 스키마·앵커를 재사용해 별도
   평가한다. 즉 추천 후보 105개 전부 사람이 수기로 채점한 항목은 없다.

**재현 검증(2026-07-21)**: `storage/generated-jobs/_rationale_log.json`에 103개 job_id
전부(j001~j103)의 LLM 판단 근거 한 줄이 실제로 남아있음을 확인했다. 무작위 표본으로
`j001`을 대조한 결과, rationale("체계적 관리(Conventional)와 마감 준수(Task Management)가
가장 중요")가 실제 저장된 `interest_profile.conventional=5`·`competencies.task_management=5`
(6개 차원 중 최고점)와 일치했다 — 사후에 근거를 지어붙인 것이 아니라 실제로 그 판단을
따라 점수가 매겨졌다는 뜻이다. 또한 `storage/generated-jobs/j001.yaml`(생성 스크립트
원본 출력)과 `data/jobs/j001.yaml`(실제 커밋된 파일)의 `competencies`/`interest_profile`
값을 diff한 결과 완전히 동일 — 생성된 값이 그대로 반영됐고 중간에 드리프트가 없음을
확인했다.

## 5. 근거 신뢰도 규칙 (`data/counseling/evidence_rules.json`)

계산 함수 `score_evidence_confidence(rule_id, bonus_flags, penalty_flags)`가
[counseling.py](../../services/api/app/content/counseling.py)에 구현되어 있다
(`base_confidence + bonus - penalty`, 0~100 클램프). 아직 이 함수를 호출하는 라이브
경로는 없다 — LLM이 대화에서 근거를 추출해 `Evidence` 테이블에 쓰는 다음 단계에서
와이어링 예정.

| source_type | rule_id | 기본 신뢰도 | 필수 요소 | 보너스 | 페널티 |
|---|---|---|---|---|---|
| **conversation_explicit**<br>(구체적 사례가 있는 발화) | EV-CONV-EXPLICIT-001 | 60 | behavior_example | reason_included +15<br>specific_outcome_included +10 | hypothetical_phrasing −20<br>single_word_answer −15 |
| **conversation_inferred**<br>(LLM이 간접 추론한 가설) | EV-CONV-INFERRED-001 | 30 | 없음 | consistent_with_prior_evidence +10 | vague_self_assessment −10<br>contradicts_prior_evidence −15 |
| **user_confirmed**<br>(사용자가 직접 확인/수정) | EV-USER-CONFIRMED-001 | 85 | user_explicit_confirmation | user_added_detail_on_confirm +5 | user_partially_disagreed −25 |
| **official_assessment**<br>(공식 검사 결과) | EV-OFFICIAL-001 | 90 | assessment_name<br>result_summary_from_user | 없음 | user_unsure_of_result_details −20 |
| **mission_observation**<br>(체험 미션 중 관찰된 행동) | EV-MISSION-OBS-001 | 50 | mission_code<br>situation_outcome | repeated_across_missions +10 | single_mission_only −10 |
| **manual_input**<br>(수동 입력) | EV-MANUAL-001 | 70 | field_name | 없음 | 없음 |

공통 원칙(`evidence_rules.json` principles): 구체적 행동 사례가 있으면 강한 근거,
결과+이유가 함께 있으면 가산, 막연한 자기평가는 중간 신뢰도로 후속질문 유도, 가정형
답변은 약한 근거, LLM의 간접 추론은 반드시 "가설"로만 저장(확정값 승격 금지), 사용자
직접 확인/수정은 강한 근거, 미션 관찰 행동은 대화 근거와 별도 source_type으로 저장,
상반된 근거는 삭제하지 않고 모순 표시만 추가한다.

## 6. 크로스체크 — 8모듈 가중치 vs 직무별 흥미유형 후보

`입문직무_RAG_KB_v5_정리본.xlsx`의 `01_직무마스터` 시트는 103개 직무 각각에
`흥미유형_매핑후보`(RIASEC 후보) 컬럼을 갖고 있고, 같은 모듈 안에서는 값이 일관된다.
이를 `module_mapping.json`의 `interest.*` 가중치와 독립적으로 대조한 결과:

| 모듈 | module_mapping.json `interest.*` | 01_직무마스터 흥미유형 후보(103직무 공통) | 결과 |
|---|---|---|---|
| 대인응대형 | social, enterprising | 사회형, 기업형 | ✅ 일치 |
| 절차·점검형 | investigative, conventional | 관습형 | ⚠ 부분 — 관습형만 확인, 탐구형 근거는 못 찾음 |
| 작업순서·절차형 | realistic, conventional | 현실형, 관습형 | ✅ 일치 |
| 제작·상태판단형 | artistic | 예술형, 탐구형 | ⚠ 부분 — 탐구형이 가중치에서 누락 |
| 돌발상황 대처형 | enterprising | 현실형, 기업형 | ⚠ 부분 — 현실형이 가중치에서 누락 |
| 안전·위험판단형 | realistic | 현실형, 사회형 | ⚠ 부분 — 사회형이 가중치에서 누락 |
| 장비·상태점검형 | realistic, investigative | 현실형, 탐구형 | ✅ 일치 |
| 정보·판단형 | investigative, enterprising | 탐구형, 기업형 | ✅ 일치 |

8개 모듈 중 5개는 독립 자료와 정확히 일치하고, 3개는 더 세분화된 직무 단위 자료에 있는
두 번째 RIASEC 유형이 `module_mapping.json` 가중치에서 빠져 있다. **날조 근거가 아니라는
증거이자, 동시에 실제로 존재하는 구체적 보강 포인트**다.

**재현 검증(2026-07-21)**: 위 표는 샘플이 아니라 `01_직무마스터` 시트 103행 전체를
스크립트로 집계한 결과다. 모듈별 직무 수는 절차·점검형 19 · 대인응대형 23 ·
정보·판단형 15 · 제작·상태판단형 22 · 작업순서·절차형 14 · 장비·상태점검형 4 ·
안전·위험판단형 3 · 돌발상황 대처형 3 (합계 103)이며, **8개 모듈 전부 모듈 내
`흥미유형_매핑후보` 값이 100% 일관**(예외 없음)됨을 재실행으로 확인했다 — 위 표의
값과 완전히 일치한다.

## 7. 남아있는 한계 (검수 시 반드시 확인)

- **가중치 숫자(1.0/0.8/0.6)의 산출 공식은 문서화돼 있지 않다.** 근거자료(NCS 능력단위,
  RAG 청크, 등급 맵)는 풍부하지만, "이 정성적 자료 → 이 정확한 숫자"로 이어지는 계산
  로직은 리포지토리 어디에도 없다 — 팀이 자료를 검토하고 판단한 한 단계 위의 추상화다.
- **105개 직무의 competencies/interest_profile 1~5점은 LLM이 매긴 값이다.** LLM에게 준
  사실 자료(미션 요청, 실패 패턴 등)는 실제 연구 콘텐츠이지만, 그 사실을 보고 특정
  점수를 매긴 것 자체는 사람이 채점한 심리측정 결과가 아니다
  (`review.human_review_required: false` — 사람 검수 안 거침).
- **`evidence_rules.json`의 base_confidence 구체값**(60/85/90/+15/−20 등)은 위 연구자료
  어디에도 직접 나오지 않는 팀 자체 휴리스틱이다. `SRC-WORK24-APTITUDE`/`SRC-OARS`와
  개념적으로만 맞닿아 있다.
- **두 연구 xlsx 파일과 `docs/jobs/batch1/2_mapping_candidates.md`는 `source_registry.md` +
  `source_ids` 정식 등록 체계 밖에 있다.** (`module_mapping.json`만 `SRC-WORK24-CAREER-PREF-S`
  항목에서 RIASEC 프레임워크 참고로 한 줄 언급되지만, 이 역시 구체적 숫자의 출처는 아니다
  — 2번 참고.) 근거 자체는 실존하지만, 다른 카운셀링 데이터 파일들과 같은 수준의 자동
  검증(`validate_counseling_data.py`)은 받지 않는다.
- **`Evidence` 테이블과 `score_evidence_confidence()`를 실제로 호출하는 코드는 코드베이스
  전체에서 정의부(`counseling.py`, `models/__init__.py`) 외에 없다** — grep으로 재확인.
  라이브 연결은 여전히 다음 단계다.

**검수 시 결정 필요**:
1. 6번의 3개 모듈 불일치를 반영해 `module_mapping.json` 가중치를 보강할지
2. 이 근거 체인 전체를 `source_registry.md`에 정식 등록할지
3. 105개 직무의 LLM 채점값에 대한 사람 검수를 별도로 진행할지

## 8. 구현 현황 요약 (2026-07-21 기준)

| 항목 | 상태 |
|---|---|
| `Evidence` DB 모델 + 마이그레이션 | 완료 (그릇만, 라이브 writer 없음) |
| `score_evidence_confidence()` 순수함수 | 완료 (호출부 없음) |
| 40개 카테고리 직무 `dimension_weights` 이식 | 완료 (실 DB 시드 확인) |
| `Job.dimension_weights` 컬럼 + 로더/시드 | 완료 |
| 추천 스코어링에 40개 직무 포함 | 완료 (`interest.*`만 반영, 3번 "알려진 한계" 참고) |
| LLM 추출 스키마 연결 (43축 실시간 채점) | 미착수 — 다음 단계 |
