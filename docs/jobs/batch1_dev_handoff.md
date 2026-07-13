# 배치1 신규 필드 — 개발 인수인계 (스키마 선작업용)

- 목적: `data/jobs/*.yaml`에 추가될 `education_requirement`/`salary`/`certifications`/
  `status` 필드를 개발 쪽에서 미리 받을 수 있도록, **실제 값과 무관하게 스키마
  구조만** 정리한 문서입니다.
- 전제: 배치1 팀 검수(5건) 결과와 무관하게 필드 구조는 이미 9건 잠정 확정
  항목(`docs/jobs/batch1_mapping_candidates.md` Section A)에서 고정되었습니다.
  즉 아래 작업은 팀 결정을 기다리지 않고 지금 시작해도 됩니다.
- **주의**: `data/jobs/*.yaml`의 실제 값 반영은 아직 하지 않은 상태입니다. 이
  문서는 값이 아니라 구조만 다룹니다. 실제 데이터 반영·커밋·푸시·PR은 팀
  검수 완료 후 별도 승인을 받고 진행합니다.

---

## 1. 현재 상태 (코드 조사로 확인됨)

| 위치 | 현재 상태 |
|---|---|
| `services/api/app/content/loader.py` `load_jobs()` | `REQUIRED_JOB_KEYS = {code, title, description, competencies}`만 검증. 신규 필드는 검증 없이 그대로 통과. |
| `services/api/app/models/__init__.py` `class Job(Base)` | code/title/description/competencies/interest_profile 컬럼만 존재. 신규 필드용 컬럼 없음 — **DB 마이그레이션 필요**. |
| `services/api/app/content/seed.py` `seed_content()` | insert/upsert 시 code/title/description/competencies/interest_profile만 명시적으로 매핑. **신규 필드는 YAML에 있어도 시딩 시 조용히 버려짐.** |
| `services/api/app/domains/jobs/schemas.py` `JobOut` | code/title/description/competencies만 노출(`from_attributes=True`). 신규 필드 API 노출 안 됨. |
| `services/api/app/domains/recommendation/service.py` | competencies/interest_profile만 사용해 스코어링. 신규 필드와 무관 — 수정 불필요. |
| 테스트 | `load_jobs()`/`JobOut`을 직접 검증하는 테스트 없음. |

## 2. 신규 필드 스키마 (9건 확정 항목 기준으로 고정됨)

```yaml
education_requirement:
  value: string | null          # 예: "고졸 이상(소규모·중소기업), 관련분야 대졸 이상(대기업)"
  source_field: string          # 예: "needKnwgCn" — 출처 API 필드명, 문서화 목적
  evidence_type: string         # 예: "descriptive_text"
  note: string | null           # 선택. 원문 요약·주의사항

salary:
  entry_level:
    min_krw: integer | null     # 현재 전 항목 null (신입 초임 근거 없음)
    max_krw: integer | null
  reference_statistics:         # null 가능 (research_status: not_found 인 경우)
    median_annual_krw: integer  # 원 단위(원문 만원 → ×10,000 환산됨)
    statistic_type: string      # 예: "median"
    population: string          # 예: "재직자 약 30명 설문조사"
    reference_year: integer     # 예: 2025
    cross_check_flag: boolean   # 선택. true면 활용 전 재검토 필요
    cross_check_note: string    # cross_check_flag=true일 때 사유

certifications:
  - name: string
    tier: "related" | "commonly_preferred" | "legally_required"

status: "provisional" | "team_review" | "not_found" | "cross_check_required"
research_status: string         # status와 별개로 유지되는 조사 진행 상태 값(과거 필드, 존치)
missing_fields: [string]        # 비어있는 최상위 필드 목록
```

전체 실 데이터 예시는 `docs/jobs/batch1_mapping_candidates.md`의 j002/j006/j007
블록을 참고하면 됩니다(실제 API 원문 기반 값).

## 3. 개발 쪽 선작업 항목 (값 확정과 무관하게 지금 가능)

1. **DB 마이그레이션**: `Job` 모델에 위 4개 필드(education_requirement/salary/
   certifications/status) 컬럼 추가. 구조가 중첩 객체·리스트이므로 JSONB 컬럼
   권장(현재 competencies/interest_profile과 동일 패턴).
2. **`seed.py` 매핑 추가**: `seed_content()`에서 새 필드를 YAML → ORM으로
   매핑하도록 수정. 지금 안 하면 나중에 YAML 값이 채워져도 DB에 반영 안 됨.
3. **`JobOut` 스키마 확장**: API로 새 필드를 노출할지, 노출한다면 전체 노출인지
   일부(예: education_requirement.value, salary.reference_statistics만) 노출인지
   결정 후 반영.
4. **로더 레벨 회귀 테스트 추가**: `load_jobs()` 근처에 새 필드 스키마 검증
   테스트 신설(현재 이 영역 테스트 없음). 아래 3가지 케이스는 향후 자동
   수집기를 만들 때도 동일하게 반영해야 함(수집기 자체는 아직 이 저장소에
   없음 — 별도 구현 필요):
   - `success:true`이지만 내부 필드가 전부 빈 값/0/null인 응답을 오류로 취급하지
     않고 `not_found`로 처리
   - 검색 API 0건 ≠ 상세 데이터 부재 (직접 코드 조회 경로 필요)
   - 임금 원문 단위(만원)를 원 단위로 정확히 환산(×10,000)했는지 검증

## 4. 스코어링/추천 로직

- `recommendation/service.py`는 competencies/interest_profile만 사용 — 신규
  필드를 추천 스코어링에 반영할지는 별도 논의 필요(현재는 표시용 참고 데이터로
  간주하고 스코어링에는 사용하지 않는 것을 전제로 위 작업을 설계함).
