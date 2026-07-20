# 4단계 미니게임 데이터 — 형식 정의

시나리오 하나당 게임 파일 하나. **NPC와 같은 방식**으로 slug으로 짝지어진다.

```
data/scenarios/ys-05.yaml   ← 조사자료에서 자동생성 (공장이 찍음)
data/npcs/ys-05.yaml        ← 사람이 관리
data/minigames/ys-05.yaml   ← 사람이 관리  ← 이 문서
```

이 폴더는 `build_scenarios emit`이 건드리지 않는다. 즉 **시나리오 첫 줄의
`# AUTO-GENERATED` 마커를 지울 필요가 없고, 조사자료 업데이트도 계속 받는다.**

---

## 공통 형식 (모든 파일이 동일)

```yaml
scenario_id: ys-05          # 필수 — data/scenarios/<이것>.yaml 과 짝
engine: spot                # 필수 — 아래 10종 중 하나 (백엔드 등록 키와 정확히 일치)
title: 위험요소 순찰         # 게임 화면 제목
intro: 현장을 돌며 위험요소를 찾아 표시하세요.   # 시작 안내 1~2줄
time_limit: 60              # 선택 — 초. 없으면 무제한
pass_score: 70              # 선택 — 기본 70
data: { ... }               # 필수 — 엔진별로 형태가 다름 (아래 참조)
```

### `engine` 에 쓸 수 있는 값 — 이 10개뿐

백엔드 `MINIGAME_COMPETENCY`에 등록된 키와 **글자까지 정확히** 같아야 한다.
다르면 점수가 조용히 버려진다(오류도 안 남).

| 키 | 뜻 | 연결되는 역량 |
|---|---|---|
| `spot` | 결함·이상 찾기 | 상황판단 |
| `gauge` | 계기 판독 | 상황판단 |
| `sort` | 분류·트리아지 | 문제해결 |
| `match` | 매칭·선긋기 | 문제해결 |
| `route` | 경로 그리기 | 문제해결 |
| `sequence` | 순서·절차 | 업무관리 |
| `pour` | 계량·붓기 | 업무관리 |
| `trace` | 따라 긋기 | 업무관리 |
| `physics` | 밸런스·리듬 | 업무관리 |
| `place` | 배치·조립 | 업무관리 |

---

## 점수 계산 (모든 엔진 공통)

프론트가 계산해서 `accuracy`(0~100)만 백엔드로 보낸다.

```
accuracy = 맞힌 것 / 맞혀야 할 것 전체 × 100
         − 오답 페널티
```

백엔드는 `{engine, accuracy, time_seconds?, mistakes?}` 를 받아
해당 역량 하나에 **25%** 섞는다. 시간·실수는 리포트 서술용으로만 저장된다.

---

## 엔진별 `data` 형태

### 1. `spot` — 결함 찾기
숨은 문제를 찾아 표시. **decoys(정상인데 누르면 실수)를 반드시 넣어** 찍기를 막는다.

```yaml
data:
  scene: 건설현장_파노라마          # 배경 스프라이트 id
  mark: x                          # 표시 방식: x | tag | shutter
  targets:                         # 찾아야 할 것
    - { sprite: 개구부_덮개없음, at: [320, 180], label: 덮개 없는 개구부 }
    - { sprite: 난간_이탈,      at: [640, 240], label: 난간 미설치 }
  decoys:                          # 정상 — 누르면 mistakes +1
    - { sprite: 안전모_착용자, at: [180, 300] }
```

> 표시 전용 — targets/decoys 항목의 `size`: 스프라이트 표시 폭(960×440 논리 캔버스 단위,
> 기본 72). 채점·클릭 판정과 무관하다. 짝(정상/이상) 오브젝트는 같은 size 로 맞춰 실루엣
> 크기 차이가 힌트가 되지 않게 한다. `scene` 스프라이트 파일이 있으면 도트 배경으로 깔리고,
> 없으면 기존 그라데이션 배경 + 라벨 칩 폴백 (ys-05 도트 아트에서 도입, 2026-07-20).

### 2. `gauge` — 계기 판독
바늘·게이지를 보고 합격/미달 판정. **숫자 대신 색 구간**으로 읽힌다.

```yaml
data:
  ok_zone: [90, 100]               # 초록 구간 (표시용, 숫자는 화면에 안 띄움)
  gauges:
    - { id: 공기호흡기_1, value: 96, verdict: pass }
    - { id: 공기호흡기_2, value: 72, verdict: fail, action: 재충전대 }
```

### 3. `sort` — 분류·트리아지
아이템을 맞는 통에 넣기. 순서가 중요하면 `priority` 사용.

```yaml
data:
  presentation: conveyor           # 선택 — 컨베이어 연출(gm-01): 물건이 한 번에 하나씩
                                   # 벨트 중앙에 도착해 자동 선택되고, 처리해야 다음이 온다.
                                   # 연출만 바뀐다(처리 순서 강제) — 채점·데이터 계약 동일.
  bins:
    - { id: 격리함, label: 격리 }
    - { id: 합격,   label: 통과 }
  items:
    - { sprite: 제품_균열, bin: 격리함, scale: 1.3 }  # scale: 스프라이트 표시 배율(기본 1)
    - { sprite: 제품_정상, bin: 합격 }                #   — 규격 차이를 눈으로 보이게(gm-01)
  order_sheet:                     # 선택 — 발주서(검수서) 상시 대조 패널(gm-01).
    label: 발주서                  # 수량은 숫자가 아니라 실루엣 칸 개수로 보인다(규칙 1).
    bin: 합격                      # 이 통(생략 시 첫 번째 bin)에 넣은 같은 sprite 수량만큼
    slots:                         # 실루엣 위에 체크가 쌓인다 — 칸이 다 찼는데 같은 박스가
      - { sprite: 제품_정상, count: 4 }  # 또 오면 '수량 초과' 함정을 화면에서 판단할 수 있다.
  escalate:                        # 선택 — 금지행동 대응 버튼 (직접 처리 대신 호출)
    { label: 매니저 호출, when: 고성_손님 }
```

### 4. `match` — 매칭·선긋기
좌우를 잇기. **`unmatched`로 짝 없는 것을 남겨** 원문 트릭을 보존한다.

```yaml
data:
  left:  [{ id: 전표_A, sprite: 카드전표_원형파랑 }]
  right: [{ id: 영수증_A, sprite: 영수증_원형파랑 }]
  pairs: [[전표_A, 영수증_A]]
  unmatched: [전표_C]              # 짝 없음 → '누락' 도장이 정답
```

### 5. `route` — 경로 그리기
출발→경유→도착 선을 긋기. 회피 구역을 지나면 실수.

```yaml
data:
  start: 차고
  waypoints: [배송지_1, 배송지_2]
  avoid: [{ zone: 어린이보호구역, penalty: 20 }]
  budget: { time: 90 }             # 연료 등 제약이 있으면 여기 추가
```

**계획+주행 2단계 확장 (jm-01)** — 아래 필드가 있을 때만 켜진다. 없는 게임은 불변:

```yaml
data:
  avoid:
    - zone: 어린이보호구역
      penalty: 40
      visible: true                # 계획 화면에 처음부터 반투명 존+표지 렌더.
                                   # 원문이 지도에 위험구역을 미리 표기하는 경우만
                                   # (jm-01 "노선도에 지름길이 보호구역 경유로 표시").
                                   # 없으면 기존 '침범 후 공개'(stn-02) 유지.
  weather_pool:                    # 게임 시작 시 1개 랜덤 — 상단 기상 배너로 표시
    - { id: 맑음, notice: 특이사항 없음 }
    - { id: 호우, effect: 서행, notice: 시야 불량 — 전 구간 서행 }
                                   # effect: 서행 → 주행 기본 속도 감소 +
                                   # when_effect: 서행 구간 활성 (규칙에 반영)
  driving:                         # 계획 제출 후 종스크롤 주행 파트(방향키/WASD 회피 조작)
    duration: 24                   # 주행 시간(초) — 20~30 권장
    obstacle_density: 0.5          # 장애물 스폰 밀도 0~1
    obstacles: [장애물_차량, 물웅덩이]   # 낙하 장애물 스프라이트 id 목록
    slow_zones:                    # 서행 의무 구간 — from/to 는 주행 진행률(0~1)
      - { id: 어린이보호구역, from: 0.3, to: 0.5, penalty: 40, sprite: 어린이보호구역_표지, reason: … }
      - { id: 시야불량구간, from: 0.6, to: 0.8, penalty: 10, when_effect: 서행 }  # 해당 기상일 때만
```

> 주행 채점: `accuracy = 계획 점수 − 주행 감점` (0~100 클램프 — 기존 채점 계약 위에
> 감점만 얹는다). 장애물 충돌 1건 = scoring `collision_penalty`(표준 키, 장애물 하나에
> 감점 하나), 서행 위반(서행선 위 과속 ≈1초 유지) = 해당 zone `penalty` **구역당 1회**
> — 감점 중첩 금지 규약 그대로. 보호구역 과속은 원문 금지행동이라 40↑(규칙 7),
> 단순 서행 의무 구간은 10~15. `prefers-reduced-motion` 환경에서는 저속·무장애물
> 간이 모드가 된다(충돌 감점 없음, 서행 의무는 판단 요소라 유지).

### 6. `sequence` — 순서·절차
정해진 순서대로 누르기. **틀린 순서를 누르면 즉시 실패**가 원칙(안전 절차라서).

```yaml
data:
  steps:                           # 이 순서가 정답
    - { id: 허가서_확인, sprite: 허가서 }
    - { id: 차단기_확인, sprite: 차단기 }
    - { id: 검전기_확인, sprite: 검전기 }
  forbidden:                       # 눌러선 안 되는 것 (금지행동)
    - { id: 차단기_직접조작, reason: 신입의 직접 차단은 금지 }
```

> 표시 전용(presentation) 필드 — 현장 맵 모드(모든 step 에 at:[x,y]가 있는 게임)에서만
> 읽히며 채점·순서 계약과 무관. 없으면 기존 렌더 폴백(ys-02·ys-10 카드 UI 불변)
> (2026-07-20, ms-10 "밑에가 잠겨서 안 됨" 피드백 대응):
> - `step.beacon: true` — 이 스텝이 다음 차례인 동안 자리를 은은히 펄스(시작 지점 안내).
>   홈 모양·노출 순서로 읽히지 않는 절차 스텝(ms-10 표지판)에만 켠다 — 자재 매립 순서
>   스텝에 켜면 정답 순서 유출(규칙 8 취지 위반).
> - `step.locked_hint` — fit 게이트로 잠긴 자리에 드롭·클릭했을 때 상태줄에 뜨는 사유
>   문구(감점 없음). 엔진은 잠긴 자리도 입력을 받아 이 문구를 보여준다 — 소리 없이
>   무시하면 '그냥 안 됨'으로 읽히기 때문. 문구에는 정답 순서를 적지 않는다(물리 사유만).

### 7. `pour` — 계량·붓기
표시선까지 붓기. 넘치거나 모자라면 감점.

```yaml
data:
  vessels:
    - { id: 밀가루, target: 0.72, tolerance: 0.05 }   # 0~1 비율
    - { id: 기름,   target: 0.30, tolerance: 0.05 }
```

> 표시 전용(presentation) 필드 — 채점·데이터 계약 불변, 파일 없으면 기존 사각 게이지 폴백
> (ms-06 도트 아트에서 도입, 2026-07-20):
> - `data.trough_sprite`: 구유 프레임 도트 스프라이트 id(엔진 기본값 `구유_나무`). 내부
>   개구부가 투명해 뒤에서 차오르는 채움(fill)이 비쳐 보인다.
> - `data.pour_sprite`: 프레스-홀드 붓기 버튼의 아이콘 id(기본값 `사료포대_삽`).
> - `vessel.sprite`: 칸 위 개체 도트 아이콘 id(축종 중립). 없으면 라벨 칩 폴백.
> - `vessel.scale`: 스프라이트 표시 배율(기본 1) — sort 의 `item.scale` 과 동일 규약.
> - 조작(2026-07-20 디자이너 피드백): 급이 버튼은 하단 공용 1개가 아니라 **구유마다 위에
>   자기 프레스-홀드 버튼**이다 — 순차 강제 없음(순서 자유), 확정한 구유의 버튼은 비활성,
>   전 구유 확정 시 종료. `data.pour_sprite` 는 이 스톨별 버튼의 아이콘 id.
> - 규칙 1 준수: target·tolerance 숫자는 어디에도 표시하지 않는다 — 목표선·허용 밴드
>   높이로만 읽힌다(기존과 동일).

### 8. `trace` — 따라 긋기
가이드라인 따라가기. `interrupts`로 "꿈틀하면 멈추기"를 만든다.

```yaml
data:
  guide: 컷_가이드라인             # 점선 경로 id
  tolerance: 8                     # 기본 허용 폭(px) — bands 가 있어도 폴백으로 반드시 둘 것
  interrupts:                      # 이 지점에서 멈췄다가 재개 (hold: 초)
    - { at: 0.4, reason: 고객이 움직임, hold: 0.6 }
```

확장 필드 (엔진이 반드시 지원해야 함 — ms-08·ms-09 가 사용):
```yaml
  bands:                           # 구간별 공차 — 정밀 구간은 좁게 (ms-09)
    - { from: 0.55, to: 0.78, tolerance: 3, color: 노랑 }
  start_gate:                      # 첫 획 전에 눌러야 하는 확인 카드 (ms-08 패치테스트)
    { action: 확인카드_탭, skip_penalty: 25 }
  terminal_stop:                   # 여기서 멈추고 '끝내는 것'이 정답 — 재개하면 실패 (ms-08 발적)
    { at: 0.88, reason: 즉시 중단이 정답 }
  emergency:                       # 돌발 신호 — 멈추고 보고 버튼, 무시하면 실패 (ms-09 균열·연기)
    { at: 0.66, signal: 균열라인_연기, action: 작업중지_보고_버튼, resume_after_report: true }
```
> `terminal_stop`·`emergency` 는 "금지행동(계속 진행)이 점수상 이득이 되면 안 된다"는
> 규칙 2를 trace 에서 구현하는 장치다. 중단·보고가 정답인 지점은 반드시 이 필드로
> 표현하고, 단순 `interrupts`(멈췄다 재개)로 두지 않는다.

> 표시 전용(presentation) 필드 — 채점·판정 계약과 무관하며, 스프라이트 파일이 없으면
> 전부 기존 렌더로 폴백한다(ms-09 도트 아트에서 도입, 2026-07-20):
> - `head: 절삭헤드_커터` — 드래그/호버 지점을 따라다니는 절삭 헤드 도트 스프라이트.
>   이 필드가 있으면 stage 가 아트 모드(data-art)로 전환돼 밴드·가이드 대비가 올라가고
>   그은 자국이 달궈진 금속색이 되며 기본 crosshair 커서가 숨는다(헤드가 커서를 대신).
> - `spark_sprite: 스파크_이펙트` — 스파크 이탈 플래시의 원광 위에 겹쳐 그리는 도트 스프라이트.
> - `guide` 값과 같은 이름의 스프라이트 파일(절삭_경로_최신본.svg)이 있으면 배경 스킨
>   (금속 판재)으로 캔버스에 꽉 채워 깔린다 — route 의 `map` 과 동일 규약.
> - `emergency.signal` 값과 같은 이름의 스프라이트 파일이 있으면 신호 마커가 라벨 칩 대신
>   도트 아이콘으로 나온다. 표시 라벨에서는 `_아이콘` 접미사를 벗겨 쓴다.
> - `no_go` 유령선에는 엔진이 취소 스탬프(X 모양)를 자동으로 얹는다 — 별도 필드 없음,
>   글자 금지(규칙 1) 준수.
> - emergency 잠금 중에는 하단 footer 가 **전용 경보 슬롯**으로 바뀐다 — `emergency.signal`
>   스프라이트(없으면 경고 원판 폴백)와 대형 보고 버튼이 경로 위 신호 마커와 같은 리듬으로
>   깜빡여 신호↔대응 버튼을 시각적으로 잇는다. 표시 전용이라 report 판정·채점 불변,
>   emergency 없는 게임(ms-08)은 기존 footer 그대로 (2026-07-20 디자이너 피드백).

### 9. `physics` — 밸런스·리듬
두 가지 모드를 한 엔진이 처리한다.

```yaml
data:
  mode: rhythm                     # rhythm | balance
  # rhythm 일 때
  beats: [{ at: 1.0, key: space }, { at: 1.5, key: space }]
  decoy_beats: [{ at: 2.2 }]       # 누르면 감점되는 가짜 박자 (jm-02)
  fails: [{ when: 서행구간_제동누락 }]  # 안전 필수 박자 누락 = 실패 (jm-02)
  # balance 일 때
  # target: 0.0                    # 수평(0) 유지
  # drift: 0.3                     # 흔들리는 세기
```

balance 확장 필드 (엔진이 반드시 지원해야 함 — ys-09 가 사용, jm-05 는 단일 축):
```yaml
  axes: [피치, 롤]                 # 다축 밸런스 — 없으면 단일 축
  tolerance: 2.0                   # 허용 기울기(±) — ys-09 는 제조사 ±2°
  hold_seconds: 3                  # 이 시간 동안 범위 안에 있어야 성공
  disturbances:                    # 중간 교란 (과보정 유도)
    - { at: 0.4, push: 0.6 }
  forbidden:                       # 시작 전 게이트 — 금지행동 (ys-09 프로펠러 미분리)
    - { id: 프로펠러_장착채_조정, reason: 분리 전 조정 시작 불가 }
```

### 10. `place` — 배치·조립
슬롯에 맞는 조각 넣기. 스펙에 없는 가짜 조각을 섞어 판단을 요구한다.

```yaml
data:
  slots:
    - { id: 상석, accepts: 팀장_명패 }
    - { id: 좌석_1, accepts: 참석자_A }
  pieces: [팀장_명패, 참석자_A, 가짜_배너]
  extras: [가짜_배너]              # 넣으면 안 되는 것
```

### 11. `typing` — 코드 타이핑 (예외 엔진)
낙하하는 코드 조각을 정확히 입력한다. **backend 전용이며 늘리지 않는다.**

> ⚠ **속도는 점수에 넣지 않는다.** `accuracy`는 오타 없이 정확히 입력했는지만 반영하고,
> 걸린 시간은 `time_seconds`로 따로 보내 리포트 서술용으로만 쓴다(팀 확정 2026-07-20).
> 속도를 섞으면 리포트가 '업무관리 역량'을 타자 실력으로 판정하게 된다.

```yaml
data:
  fall_seconds: 6                  # 한 조각이 바닥에 닿기까지
  lines:
    - { id: dup, text: "if already_sent(user, notice): skip()", label: 중복 발송 차단 }
    - { id: optout, text: "if user.opted_out: skip()",        label: 수신거부 제외 }
  distractors:                     # 입력하면 안 되는 줄 (스펙에 없는 처리)
    - { id: force, text: "send_all(users)", reason: 조건 확인 없이 전체 발송 }
```

---

## 표준 채점 키 (엔진 공통 — 이 이름만 쓴다, 파일마다 다르면 엔진이 못 읽는다)

| 키 | 뜻 | 권장값 |
|---|---|---|
| `wrong_bin_penalty` | sort: 틀린 통 | 10~15 |
| `wrong_slot_penalty` | place: 틀린 슬롯 (wrong_plug/misplace 등 변형 금지) | 10~15 |
| `wrong_pair_penalty` | match: 틀린 선 | 12~15 |
| `forbidden_penalty` | 금지행동 항목·통·페어 (합격선을 뚫어야 함) | **40** |
| `missed_escalate_penalty` | 호출·보고가 정답인데 안 함 (방치) | 원문 정답이면 **40**, 보조 절차면 15~25 |
| `stage_skip_penalty` | sudden.stages 생략·순서 위반 (건당) | 15 |
| `ignore_sudden_penalty` | 돌발을 아예 응대하지 않고 종료 | **40** |
| `early_escalate_penalty` | 단계 전 성급한 호출 | 25 (escalate.early_penalty 와 중복 정의 금지 — scoring 쪽만) |
| `decoy_penalty` | 함정 클릭 | '전부 클릭' 합계가 30을 넘게 (개당 15~20 또는 개수 확보) |
| `collision_penalty` | route 주행: 장애물 충돌 (장애물 하나 = 사건 하나) | 5~10 (금지행동 아님 — 서행 위반은 slow_zones 의 zone별 penalty) |
| 감점 중첩 | 한 사건에는 **가장 무거운 감점 하나만** 적용 (중첩 금지) — 전 엔진 공통 |

## 엔진 확장 필드 추가분 (45개 작성 과정에서 확정)

- **route**: `report_at`(도착해 보고하면 성공 — **실재 노드 id여야 함**), `signals`(구간 상태등),
  `log_hints`(보조 단서), `decoy_waypoints`, `submit_as`, scoring `wrong_turn_penalty`
  (avoid의 penalty 와 중첩 금지 — 사건당 하나만),
  `blockers`(경로상 발견·보고물 — stn-02): `[{ id, at, sprite, action, missed_penalty }]`
  — 통과·회피가 아니라 **발견해 action(보고)** 하는 것이 정답. 보고 없이 제출하면(방치)
  missed_penalty (원문 금지행동이면 40).
- **route 계획+주행 2단계 (jm-01, 2026-07-20)**: avoid 항목 `visible: true`(계획 화면 사전
  표시 — 원문이 지도에 표기하는 구역만), `weather_pool`(랜덤 기상 배너 — `effect: 서행`은
  주행 속도·구간 활성에 반영), `driving`(종스크롤 주행 파트 — `{ duration, obstacle_density,
  obstacles, slow_zones[{id, from, to, penalty, sprite?, reason?, when_effect?}] }`),
  scoring `collision_penalty`. 상세는 위 5. route 절 참조. **driving 이 없는 route 게임은
  전부 기존 단일(계획) 흐름 그대로다.** 주행 배경 스크롤에는 트럭 y 기반 시각 배속이 곱해진다
  (위=빠름, 렌더 전용 — 장애물 y·진행률·충돌 판정은 배속 무관, 2026-07-20 속도감 피드백).
- **physics balance**: `settle`(내려놓기형 — 크레인류): `{ target_zone, tolerance, sway_fail(기울기 초과=실패), drop_fail(과속 착지=실패) }`.
  intro 가 '실패'라고 고지한 조작은 감점이 아니라 실패로 채점한다.
- **place**: `stains`(문지르기·교체형 정비 — cln-01): `[{ id, resolve: 문지르기|교체, sprite }]`.
  교체용 새 부품은 슬롯 채우기와 별개 채점 단위로 세지 않는다(이중 계산 금지).
- **match**: `stream`(흐름 속 이상치 클릭 — stn-03): `{ beads: [...], outliers: [...], decoy_beads: [...] }`.
- **사후 반박 검증(2026-07-20) 추가 등재** — 아래 필드는 엔진이 반드시 지원해야 한다:
  - sort: `must_resolve_sudden`(돌발 처리 전 종료 불가)·`freeze_queue`(kts-01), item `forbidden_bin`(이
    통에 넣으면 금지행동=forbidden_penalty — gm-01·yg-02), scoring `escalate_mode`(대체|병행필수), `item_count`
  - sort 표시 전용(2026-07-20, gm-01 디자이너 피드백): `병행필수`+`presentation: conveyor` 조합에선
    escalate(사진) 버튼이 벨트 중앙 박스가 `escalate.when` 대상일 때마다 재활성화된다(박스별 촬영
    연출 — 셔터+'촬영됨' 태그). 채점은 기존대로 '게임 중 1회 이상 눌렀는가'만 보며 추가 촬영은
    감점·가점 없음. conveyor 아닌 병행필수는 기존 1회 절차 동작 유지.
  - match: `discard` 블록(휴지통 — stn-01), `keys`+`wrong_key_penalty`(kts-05 객실 키),
    `one_line_per_left`·forbidden_pairs 의 right **리스트** 허용(kts-02),
    `unmatched_action`+`missed_unmatched_penalty`(stn-04), `matched_unmatched_penalty`, `pair_count`/`unmatched_count`
  - match 표시 전용(2026-07-20, ys-03 디자이너 피드백): `unmatched_action` 은 짝없음 도장의
    **표시 라벨**이기도 하다(채점 무관 — stn-04 `재검증_표시`, ys-03 `불가능`; 없으면 기본 '짝 없음').
    카드 `detector: true` 는 게이트 경보 램프(하드 점멸+확산 링)+카드 흔들림·붉은 펄스를 그리는
    시각 단서 — 정답(벨)을 가리키는 표시는 금지, 어떤 방식으로 처리되든 경보는 동일하게 잦아든다.
    `data.forbidden` 버튼은 누르는 즉시 제지 배너(reason 노출)+빨간 상태로 남는다 — 감점은
    기존대로 최종 채점 1회 반영, 문구는 누른 뒤에만 나와 사전 유출 아님.
  - place: `fit: any`(비게이트 — 어디든 꽂히되 틀리면 시각 피드백)·`accepts: null`(정상 구간 — stn-05),
    forbidden 항목 `{ id, slots?, reason }`(hr-01)
  - physics rhythm: `stray_input_penalty`(창 밖 연타)·`beat_count`(jm-02)
  - typing: `critical_lines`+`missed_critical_penalty`(핵심 예외 줄 누락 = 금지행동 40 — backend)
  - typing: `data.presentation: dev_desk`(표시 전용 — backend-dev-day1, 2026-07-20) — 낙하
    스테이지를 도트 모니터 프레임(`모니터_터미널`)으로 감싸고 코드 줄을 알림 봉투(`알림_봉투`)
    카드에 담아 내린다. 봉투는 lines/distractors 겉모습이 **완전히 동일**해야 하며, 스킨
    모드에선 정답을 유출하는 `label` 배지도 낙하 중 그리지 않는다 — 구분 근거는 코드 텍스트
    (스프라이트가 아닌 실제 DOM monospace 텍스트)뿐이다(글자 판독 공인 예외 게임이라 허용).
    정확 입력=발송차단 스탬프, distractor 입력=경고 스탬프 FX. 이 키가 없거나 스프라이트
    파일이 없으면 기존 플레인 렌더로 폴백. 채점·낙하 물리(wall-clock 역산) 불변.
  - route: avoid 항목의 설명은 `reason`(비노출)만 — `label` 은 화면에 렌더되어 위험구역을 사전 유출하므로 금지
  - trace stains 의 `resolve` 값은 문서 enum(문지르기|교체)과 **글자까지 일치**해야 한다
- **아이템 시각 단서 규약**: 아이템의 color/icon 이 정답 통(bin)의 color/icon 과 1:1로 같으면
  '색 맞추기'가 되어 판단이 사라진다 — 아이템에는 **증상·상태의 시각 단서만** 주고,
  통 대응은 기준표(범례)를 보고 판단하게 한다. 동일하게 생긴 아이템 두 개를 서로 다른
  특정 정답에 고정하지 않는다(교차 배정이 가능해야 하면 `equivalent: [a, b]` 로 명시).

---

## 규칙 (46개 검증에서 나온 것 — 새 파일도 이걸 지킨다)

1. **글자·숫자를 읽혀 풀게 하지 않는다.** 색 구간·아이콘·스프라이트로만.
   저해상도 도트에서 글자가 뭉개지고, 2단계(사수의 퀴즈)와 성격이 겹치기 때문이다.
   **예외 2건 (팀 확정 2026-07-20) — 이 둘만이고 더 늘리지 않는다:**
   - `backend` (코드 타이핑) — 코드 입력 자체가 업무라 글자가 불가피. 단 **타자 속도는
     점수화하지 않는다**(정확도만). 속도는 `time_seconds`로 따로 보내 서술용으로만 쓴다.
   - `yg-04` (로그 미로) — 장애 구간 추적. 길찾기 단서는 **상태등(녹/황/적)과 아이콘**을
     주로 쓰고, 로그 텍스트는 보조로만 노출한다.
2. **금지행동은 게임에서도 금지.** 직접 조치가 아니라 호출·보고가 정답이면 `escalate`/`forbidden`으로 넣는다.
3. **2단계 퀴즈와 겹치지 않는다.** '순서 맞추기'가 퀴즈에 있으면 여기선 물리 조작으로.
4. **원문에 있는 트릭을 보존한다.** 순찰차 2대, 짝 없는 전표 1건 등.
5. **decoy/extras를 반드시 넣는다.** 다 누르면 만점이 되는 게임은 역량 측정이 안 된다.
6. **escalate 참조 규약** — `when` 은 다음 셋 중 하나여야 한다(검증기가 강제):
   - 실재하는 항목 id (`when: 입장객_E`)
   - 실재하는 항목 id 목록 (`when: [박스_수침_1, 박스_수침_2]`)
   - 상태 조건 — `_발생`/`_지속` 으로 끝나는 이름 (`when: 업무방해_지속`).
     조건의 성립 정의(예: `sudden.persists_after_stages: true`)가 같은 파일에 있어야 한다.
   `requires` 의 단계명은 `stages`(또는 `sudden.stages`)에 실재해야 한다.
7. **금지행동 구역·항목의 감점은 합격선을 뚫어야 한다.** pass_score 70 기준,
   최악의 금지행동 1회 감점이 30 이하면 '위반하고도 합격'이 전략이 된다 — 40 이상으로.
   (단, 금지행동이 아닌 단순 비효율 구간은 예외 — yg-04의 갈림길 등.)
8. **fail 항목의 라벨은 정답을 유출하면 안 된다.** 과열·경보·이상 같은 접미나 수치를
   라벨에 쓰지 말 것 — 판별은 바늘·색·모양으로만. 근거는 주석에 남긴다.
