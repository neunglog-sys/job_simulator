# 시나리오 게임 LIVE 패널에 AI 아바타 연결 — 설계

- 작성일: 2026-07-24
- 상태: 승인됨 (C안 우선 시도, 안 되면 B안)

## 배경

시나리오 게임 페이지(`ScenarioGamePage.tsx`)의 코치 패널에는 `AiAvatarViewport`라는 "LIVE" 배지 박스가 있는데, 지금은 `children`을 아무도 안 넘겨서 항상 로봇 아이콘 플레이스홀더만 보인다(`AiAvatarViewport.tsx:8` — `children ?? <플레이스홀더>`). 이미 완성된 실시간 MuseTalk 아바타(`AiAvatarStage`, 1:1 상담 페이지에서 사용 중)를 이 박스에 연결한다.

단순 컴포넌트 교체가 아닌 이유:
1. `ScenarioGamePage`에는 아바타 WS 연결 로직이 전혀 없다.
2. `coachMessage` state가 **14곳**에서 갱신되는데, 그중 다수(연결 중/에러/설정 안내 등)는 UI 상태 문구지 "코치가 하는 말"이 아니다.
3. `AiAvatarStage`는 `position: absolute` + 1:1 페이지 전용 CSS 변수(`--avatar-top/left/width/height`, 픽셀 고정값)에 의존해 큰 패널용으로 만들어져 있다 — 265px짜리 작은 LIVE 박스에 그대로 안 맞을 수 있다.

## 목표 / 비목표

**목표**
- 코칭 내용(안내/피드백/팁)이 뜰 때 아바타가 실제로 그 텍스트를 음성+립싱크로 말한다.
- 연결상태/에러 같은 시스템 문구는 말풍선 텍스트만 바뀌고 아바타는 말하지 않는다.
- 같은 문장이 연속으로 다시 뜨면(effect 재실행 등) 중복 재생하지 않는다.

**비목표(이번 스코프 제외)**
- 1:1 상담 페이지의 문장 청킹·prefetch 큐 재현 — 코치 문구는 짧아서 불필요(YAGNI).
- 아바타 남/여 선택 — 별도 진행 중인 작업(`2026-07-24-musetalk-avatar-select-design.md`)이고 이번 스코프와 독립적. 이번 기능은 그 결과와 무관하게 기본 아바타로 말한다.
- WS/MSE 로직을 훅으로 추출해 두 페이지가 공유하는 리팩터(B안 검토 시 필요하면 별도 스코프).

## 결정된 사항

| 항목 | 결정 |
|---|---|
| 말하게 할 트리거 | 코칭 내용만(안내/팁/피드백). 연결상태·에러 문구는 제외 |
| 청킹/프리페치 | 안 가져옴 — 트리거 1번 = 요청 1번 |
| 레이아웃 접근 | **C안(CSS 변수 지역 재정의) 먼저 시도** → 시각적으로 안 맞으면 B안(별도 단순 컴포넌트)으로 전환 |

## 설계

### 1. 말하기 트리거 지점 (7곳만 교체)

`ScenarioGamePage.tsx`에서 `coachMessage`를 갱신하는 곳은 총 18곳이다. 그중 아래 7곳만 새 `speakCoach(text)`로 교체하고, 나머지 11곳(연결중/에러/설정안내 등)은 기존 `setCoachMessage` 그대로 둔다.

| 줄(현재) | 내용 | 성격 |
|---|---|---|
| 490 | `approachGuide`/`introGuide` | 탐색 단계 안내 |
| 562 | `approachGuide(sim.step, sim.npcs)` | 안내 |
| 675 | `questResult.feedback` | 퀘스트 피드백 |
| 696 | `onCoachTip` (LLM 생성) | 실시간 코치 팁 |
| 758 | `frame.coach_message` (서버 프레임) | 서버발 코치 메시지 |
| 772 | `approachGuide(step, npcsRef.current)` | 안내 |
| 1012 | `MovementArea.onCoachMessage` (경로 prompt/오브젝트 message) | 이동 중 안내 |

제외(그대로 `setCoachMessage`): 614/785(에러), 806/832/871/925/948/964(연결 중), 921(투어 준비 대기), 976(전체화면 거부), 1040(설정 안내).

### 2. `speakCoach` 동작

```ts
const museTalkRequestIdRef = useRef(0);
const lastSpokenRef = useRef<string | null>(null);
const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
const [museTalkRequest, setMuseTalkRequest] =
  useState<MuseTalkStageRequest | null>(null);

const speakCoach = useCallback((text: string) => {
  setCoachMessage(text);                    // 말풍선은 항상 갱신
  const trimmed = text.trim();
  if (!trimmed || trimmed === lastSpokenRef.current) return;  // 연속 중복 억제
  lastSpokenRef.current = trimmed;
  setMuseTalkRequest({ id: ++museTalkRequestIdRef.current, text: trimmed });
  setAvatarStatus("speaking");
}, []);

const handleSpeakingEnd = useCallback(() => {
  setMuseTalkRequest(null);
  setAvatarStatus("idle");
}, []);

const handleSpeakingError = useCallback(() => {
  setMuseTalkRequest(null);
  setAvatarStatus("idle");
}, []);
```

1:1 페이지의 `handleSpeakingEnd`(대기 큐 재생)와 달리, 여기는 큐가 없으므로 그냥 idle로 되돌린다.

### 3. `AiAvatarStage` 연결

```tsx
<AiAvatarViewport>
  {museTalkRequest ? (
    <AiAvatarStage
      status={avatarStatus}
      museTalkRequest={museTalkRequest}
      onSpeakingEnd={handleSpeakingEnd}
      onSpeakingError={handleSpeakingError}
    />
  ) : null}
</AiAvatarViewport>
```

`hlsUrl`, `onMuseTalkMetrics`는 옵셔널이고 이번 기능에 불필요해 생략한다. `museTalkRequest`가 없을 때(말하는 중이 아닐 때)는 `children`을 안 넘겨 기존 로봇 플레이스홀더가 그대로 보이게 한다(idle 영상 상시 재생 같은 추가 기능은 비목표).

### 4. CSS — C안: 변수 지역 재정의

`scenarioGame.module.css`의 `.avatarViewport`(이미 `position: relative; overflow: hidden`)에 아래를 추가한다:

```css
.avatarViewport {
  /* 기존 속성 유지 */
  --avatar-left: 0px;
  --avatar-top: 0px;
  --avatar-width: 100%;
  --avatar-height: 100%;
}
```

`AiAvatarStage`의 루트(`.avatarStage`, `oneToOneConversation.module.css:597`)가 이 변수들을 그대로 쓰므로, 별도 컴포넌트 수정 없이 박스 안에 맞춰질 것으로 기대한다. `.avatarStage`의 `border-radius: 30px 30px 0 0`나 배경 그라디언트가 작은 박스에서 시각적으로 안 어울릴 수 있음 — 이건 코드로 미리 판단할 수 없고 **브라우저로 직접 보고 판단**한다.

**판정 기준**: 브라우저에서 실제 발화 1회 실행 후 육안 확인.
- 영상이 박스 안에 올바른 비율로 보이고 크게 벗어나지 않으면 → C안 채택.
- 잘리거나, 위치가 벗어나거나, 시각적으로 어색하면 → B안(별도 단순 컴포넌트, idle 위상동기화 없이 "플레이스홀더 ↔ 말하는 영상"만) 으로 전환.

## 검증 계획

1. 타입체크: `npm run lint`(`tsc -b`) exit 0.
2. 브라우저 수동 확인: 시나리오 게임 진입 → 코치 안내가 뜨는 시점(예: NPC 접근)에서 LIVE 박스에 실제 영상이 뜨고 말하는지 확인.
3. 연결상태 문구(예: 새로고침 직후 "게임 서버에 연결 중이에요")가 떴을 때 아바타가 **말하지 않는지** 확인(말풍선 텍스트만 바뀜).
4. 같은 안내가 연속으로 두 번 setCoachMessage 되는 상황(예: `useEffect` 재실행)에서 아바타가 **중복 재생하지 않는지** 확인.
5. CSS 육안 판정 (위 판정 기준).

## 리스크 / 오픈 이슈

- C안이 시각적으로 안 맞으면 B안으로 전환 — 전환 시 추가 설계/계획 필요(이번 계획 범위 밖).
- `AiAvatarStage`의 WS 파이프라인이 1:1 페이지와 시나리오 페이지에서 **동시에** 열릴 가능성(같은 유저가 두 탭?) — GPU_LOCK이 코랩 쪽에서 직렬화하므로 깨지진 않지만 느려질 수 있음. 실사용에서 동시 발생 가능성 낮다고 보고 이번 스코프에서 다루지 않음.
- 아바타 선택(남/여) 작업과 완전히 독립 — 이번 기능은 그 작업 완료 여부와 무관하게 동작해야 한다.
