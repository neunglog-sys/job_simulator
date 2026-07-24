# 시나리오 LIVE 패널 AI 아바타 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시나리오 게임 페이지의 "LIVE" 코치 패널이 로봇 아이콘 플레이스홀더 대신, 코칭 내용(안내·팁·피드백)이 뜰 때 실제 MuseTalk 아바타가 그 텍스트를 말하도록 연결한다.

**Architecture:** 기존 `AiAvatarStage`(1:1 상담 페이지에서 이미 검증된 WS/MSE 컴포넌트)를 그대로 재사용한다. `coachMessage`를 갱신하는 18개 지점 중 코칭 내용 7곳만 새 `speakCoach()` 래퍼로 교체해 발화를 트리거하고, 나머지 11곳(연결상태/에러)은 손대지 않는다. 레이아웃은 CSS 커스텀 프로퍼티를 시나리오 페이지의 `.avatarViewport`에 지역 재정의해 `AiAvatarStage`의 절대좌표를 그 박스 안에 맞춘다(C안).

**Tech Stack:** React + TypeScript, CSS Modules.

## Global Constraints

- 스펙: [`docs/superpowers/specs/2026-07-24-scenario-coach-avatar-design.md`](../specs/2026-07-24-scenario-coach-avatar-design.md) — 승인됨, 변경 없음.
- `apps/web`에는 테스트 러너가 없다(vitest/jest 없음, `*.test.ts` 파일 전무 — 기존 세션에서 이미 확인된 사실). 검증 게이트는 `npm run lint`(`tsc -b`) exit 0 + **브라우저 수동 확인**이다.
- `AiAvatarStage`(`components/conversation/AiAvatarStage.tsx`)는 **변경하지 않는다** — 1:1 상담 페이지에서 이미 튜닝된 컴포넌트를 그대로 재사용한다.
- 트리거 대상은 **코칭 내용 7곳만**(490, 562, 675, 696, 758, 772, 1012번 줄의 `coachMessage` 갱신). 연결상태·에러·설정안내 등 11곳(614, 785, 806, 832, 871, 921, 925, 948, 964, 976, 1040번 줄)은 **그대로 `setCoachMessage` 유지** — 아바타가 시스템 문구를 말하게 하면 안 된다.
- 1:1 상담 페이지의 문장 청킹·prefetch 큐는 **가져오지 않는다**(YAGNI) — 트리거 1번 = 발화 요청 1번.
- CSS는 C안(변수 지역 재정의)을 시도한다. **브라우저로 직접 보고 시각적으로 안 맞으면** 이 계획을 넘어서는 B안(별도 컴포넌트) 재설계가 필요하다 — 그 경우 이 태스크를 DONE_WITH_CONCERNS로 보고하고 controller가 판단한다.
- `avatar_id`(남/여 선택) 기능과는 **독립**이다. 이번 기능은 그 작업 완료 여부와 무관하게 기본 아바타로 동작해야 한다.

---

## Task 1: 시나리오 코치 패널에 AI 아바타 연결

**Files:**
- Modify: `apps/web/src/components/scenario/AiCoachPanel.tsx`
- Modify: `apps/web/src/pages/ScenarioGamePage.tsx` (imports, state/ref, `speakCoach`/핸들러, 7개 트리거 지점, 렌더 배선)
- Modify: `apps/web/src/styles/scenarioGame.module.css` (`.avatarViewport`에 CSS 변수 추가)
- Test: 이 저장소의 `apps/web`엔 테스트 러너가 없다. 검증은 `npm run lint`(`tsc -b`) + 브라우저 수동 확인(Step 9-12).

**Interfaces:**
- Consumes: `AiAvatarStage`(기존, 변경 없음) — `status: AvatarStatus`, `museTalkRequest: (MuseTalkSpeakRequest & {id:number}) | null`, `onSpeakingEnd: () => void`, `onSpeakingError: () => void`. (`hlsUrl`/`onMuseTalkMetrics`는 옵셔널이라 생략.)
- Consumes: `AiAvatarViewport`(기존, 변경 없음) — `children?: ReactNode`. children이 있으면 그걸 렌더링하고, 없으면 기존 로봇 플레이스홀더를 보여준다(`AiAvatarViewport.tsx:8`).
- Produces: `AiCoachPanelProps.children?: ReactNode` — 새로 추가, `AiAvatarViewport`로 그대로 전달.

- [ ] **Step 1: `AiCoachPanel`이 `children`을 받아 `AiAvatarViewport`로 전달하게 수정**

`apps/web/src/components/scenario/AiCoachPanel.tsx`의 현재 전체 내용:

```tsx
import { AiAvatarViewport } from "./AiAvatarViewport";
import { CoachSpeechBubble } from "./CoachSpeechBubble";
import styles from "../../styles/scenarioGame.module.css";

type AiCoachPanelProps = {
  message: string;
};

export function AiCoachPanel({ message }: AiCoachPanelProps) {
  return (
    <section className={`${styles.glassPanel} ${styles.coachPanel}`} aria-label="AI 코치">
      <AiAvatarViewport />
      <CoachSpeechBubble message={message} />
    </section>
  );
}
```

아래로 전체 교체:

```tsx
import type { ReactNode } from "react";
import { AiAvatarViewport } from "./AiAvatarViewport";
import { CoachSpeechBubble } from "./CoachSpeechBubble";
import styles from "../../styles/scenarioGame.module.css";

type AiCoachPanelProps = {
  message: string;
  children?: ReactNode;
};

export function AiCoachPanel({ message, children }: AiCoachPanelProps) {
  return (
    <section className={`${styles.glassPanel} ${styles.coachPanel}`} aria-label="AI 코치">
      <AiAvatarViewport>{children}</AiAvatarViewport>
      <CoachSpeechBubble message={message} />
    </section>
  );
}
```

- [ ] **Step 2: `ScenarioGamePage.tsx`에 필요한 import 추가 (3곳)**

`apps/web/src/pages/ScenarioGamePage.tsx:1-6`의 현재 코드:

```typescript
import { UserCircle } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import { SpaceLoadingScreen } from "../components/SpaceLoadingScreen";
import { AiCoachPanel } from "../components/scenario/AiCoachPanel";
```

아래로 교체(2번째 줄 뒤에 `AiAvatarStage` import 추가):

```typescript
import { UserCircle } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import { SpaceLoadingScreen } from "../components/SpaceLoadingScreen";
import { AiAvatarStage } from "../components/conversation/AiAvatarStage";
import { AiCoachPanel } from "../components/scenario/AiCoachPanel";
```

`apps/web/src/pages/ScenarioGamePage.tsx:29-39`의 현재 코드(기존 `../lib/api` import 블록):

```typescript
import {
  ApiError,
  createReport,
  createSimulation,
  fetchReport,
  fetchSimulation,
  type GameNpc,
  type GameStep,
  type GameTask,
  type Simulation,
} from "../lib/api";
```

아래로 교체(`type MuseTalkSpeakRequest,` 한 줄만 추가):

```typescript
import {
  ApiError,
  createReport,
  createSimulation,
  fetchReport,
  fetchSimulation,
  type GameNpc,
  type GameStep,
  type GameTask,
  type MuseTalkSpeakRequest,
  type Simulation,
} from "../lib/api";
```

`apps/web/src/pages/ScenarioGamePage.tsx:41-48`의 현재 코드:

```typescript
import {
  SimulationSocket,
  type AdviceCard,
  type CoachCardsFrame,
  type TaskResultFrame,
  type TourFrame,
} from "../lib/simulationSocket";
import styles from "../styles/scenarioGame.module.css";
```

아래로 교체(`AvatarStatus` import 한 줄 추가):

```typescript
import {
  SimulationSocket,
  type AdviceCard,
  type CoachCardsFrame,
  type TaskResultFrame,
  type TourFrame,
} from "../lib/simulationSocket";
import type { AvatarStatus } from "../types/conversation";
import styles from "../styles/scenarioGame.module.css";
```

- [ ] **Step 3: 타입체크로 import 단계 검증**

Run: `cd apps/web && npm run lint`
Expected: `tsc -b --pretty false` exit 0. (아직 새 이름들을 안 썼으니 "선언했지만 안 씀" 경고가 날 수 있다 — 이후 스텝에서 해소된다. 에러가 아니라 경고면 계속 진행.)

- [ ] **Step 4: 아바타 상태/요청 state + refs + `speakCoach`/핸들러 추가**

`apps/web/src/pages/ScenarioGamePage.tsx:240-243`의 현재 코드:

```typescript
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);
  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [stageScale, setStageScale] = useState(getStageScale);
```

아래로 교체:

```typescript
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [coachMessage, setCoachMessage] = useState(DEFAULT_COACH_MESSAGE);

  // ── AI 아바타 발화 (LIVE 패널) ──────────────────────────────────────────
  // coachMessage는 연결상태·에러 문구까지 포함해 18곳에서 갱신되지만, 그중
  // "코치가 실제로 하는 말"(안내·팁·피드백)만 아바타가 말해야 한다. speakCoach는
  // 그 구분을 위한 래퍼 — 시스템 문구는 지금처럼 setCoachMessage를 그대로 쓴다.
  const museTalkRequestIdRef = useRef(0);
  const lastSpokenRef = useRef<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("idle");
  const [museTalkRequest, setMuseTalkRequest] =
    useState<(MuseTalkSpeakRequest & { id: number }) | null>(null);

  const speakCoach = useCallback((text: string) => {
    setCoachMessage(text);
    const trimmed = text.trim();
    // 같은 문장이 effect 재실행 등으로 다시 들어와도 중복 재생하지 않는다.
    if (!trimmed || trimmed === lastSpokenRef.current) return;
    lastSpokenRef.current = trimmed;
    setMuseTalkRequest({ id: ++museTalkRequestIdRef.current, text: trimmed });
    setAvatarStatus("speaking");
  }, []);

  const handleAvatarSpeakingEnd = useCallback(() => {
    setMuseTalkRequest(null);
    setAvatarStatus("idle");
  }, []);

  const handleAvatarSpeakingError = useCallback(() => {
    setMuseTalkRequest(null);
    setAvatarStatus("idle");
  }, []);

  const [playerPosition, setPlayerPosition] = useState<Position>({ x: 420, y: 290 });
  const [stageScale, setStageScale] = useState(getStageScale);
```

- [ ] **Step 5: 7개 트리거 지점을 `speakCoach`로 교체**

**5-1.** `apps/web/src/pages/ScenarioGamePage.tsx:488-491`의 현재 코드:

```typescript
    setCoachMessage(
      needsTour ? introGuide(activeStep, npcsRef.current) : approachGuide(activeStep, npcsRef.current),
    );
```

아래로 교체:

```typescript
    speakCoach(
      needsTour ? introGuide(activeStep, npcsRef.current) : approachGuide(activeStep, npcsRef.current),
    );
```

**5-2.** `apps/web/src/pages/ScenarioGamePage.tsx:562`의 현재 코드:

```typescript
      setCoachMessage(approachGuide(sim.step, sim.npcs));
```

아래로 교체:

```typescript
      speakCoach(approachGuide(sim.step, sim.npcs));
```

**5-3.** `apps/web/src/pages/ScenarioGamePage.tsx:675`의 현재 코드:

```typescript
            if (questResult.feedback) setCoachMessage(questResult.feedback);
```

아래로 교체:

```typescript
            if (questResult.feedback) speakCoach(questResult.feedback);
```

**5-4.** `apps/web/src/pages/ScenarioGamePage.tsx:696`의 현재 코드:

```typescript
          onCoachTip: (text) => !cancelled && setCoachMessage(text),
```

아래로 교체:

```typescript
          onCoachTip: (text) => !cancelled && speakCoach(text),
```

**5-5.** `apps/web/src/pages/ScenarioGamePage.tsx:758`의 현재 코드:

```typescript
            if (frame.coach_message) setCoachMessage(frame.coach_message);
```

아래로 교체:

```typescript
            if (frame.coach_message) speakCoach(frame.coach_message);
```

**5-6.** `apps/web/src/pages/ScenarioGamePage.tsx:772`의 현재 코드:

```typescript
            setCoachMessage(approachGuide(step, npcsRef.current));
```

아래로 교체:

```typescript
            speakCoach(approachGuide(step, npcsRef.current));
```

**5-7.** `apps/web/src/pages/ScenarioGamePage.tsx:1012`의 현재 코드:

```typescript
          onCoachMessage={setCoachMessage}
```

아래로 교체:

```typescript
          onCoachMessage={speakCoach}
```

⚠️ 아래 11곳은 **건드리지 않는다**(그대로 `setCoachMessage` 유지) — 614, 785, 806, 832, 871, 921, 925, 948, 964, 976, 1040번 줄.

- [ ] **Step 6: 렌더 부분에 `AiAvatarStage`를 `AiCoachPanel`의 children으로 배선**

`apps/web/src/pages/ScenarioGamePage.tsx:1180`의 현재 코드:

```tsx
          <AiCoachPanel message={coachMessage} />
```

아래로 교체:

```tsx
          <AiCoachPanel message={coachMessage}>
            {museTalkRequest ? (
              <AiAvatarStage
                status={avatarStatus}
                museTalkRequest={museTalkRequest}
                onSpeakingEnd={handleAvatarSpeakingEnd}
                onSpeakingError={handleAvatarSpeakingError}
              />
            ) : null}
          </AiCoachPanel>
```

- [ ] **Step 7: 타입체크로 전체 검증**

Run: `cd apps/web && npm run lint`
Expected: `tsc -b --pretty false` exit 0, 에러·경고 없음.

- [ ] **Step 8: CSS 변수 지역 재정의 (C안)**

`apps/web/src/styles/scenarioGame.module.css:1828-1839`의 현재 코드:

```css
.avatarViewport {
  position: relative;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.28);
  border-radius: 15px;
  background: #17132d;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 18px 36px rgb(32 22 81 / 0.24);
}
```

아래로 교체(CSS 커스텀 프로퍼티 4개 추가, 나머지는 그대로):

```css
.avatarViewport {
  position: relative;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.28);
  border-radius: 15px;
  background: #17132d;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 18px 36px rgb(32 22 81 / 0.24);
  /* AiAvatarStage(1:1 상담 페이지 전용 컴포넌트)는 --avatar-top/left/width/height
     CSS 변수로 절대좌표를 잡는다. 그 변수는 원래 oneToOneConversation.module.css의
     .stage에서만 정의되는데, 이 페이지 DOM에는 .stage가 없어 값이 비어 top/left가
     auto로 계산돼버린다. 여기서 이 박스를 꽉 채우도록 지역 재정의한다.
     CSS 커스텀 프로퍼티는 DOM 상속이라 어느 모듈이 선언했는지와 무관하게 적용된다. */
  --avatar-top: 0px;
  --avatar-left: 0px;
  --avatar-width: 100%;
  --avatar-height: 100%;
}
```

- [ ] **Step 9: 브라우저 수동 확인 — 코칭 내용에서 아바타가 말하는지**

개발 서버(`npm run dev`)로 시나리오 게임 페이지에 진입해 코칭 안내가 뜨는 시점(예: NPC에게 접근할 때 `approachGuide` 트리거)까지 진행한다.

Expected: LIVE 박스에 로봇 플레이스홀더 대신 **실제 영상이 나타나고 코칭 문구를 소리+립싱크로 말한다.**

- [ ] **Step 10: 브라우저 수동 확인 — 시스템 문구는 말하지 않는지**

페이지 새로고침 직후("게임 서버에 연결 중이에요" 같은 문구가 말풍선에 뜨는 타이밍)를 관찰한다.

Expected: 말풍선 텍스트는 바뀌지만 **LIVE 박스는 로봇 플레이스홀더 그대로**(아바타가 말을 시작하지 않는다).

- [ ] **Step 11: 브라우저 수동 확인 — 연속 중복 재생 방지**

같은 안내가 반복해서 뜰 수 있는 상황을 재현한다(예: `phase`/`activeStep`이 안 바뀐 채 다른 의존성만 바뀌어 488번 줄의 `useEffect`가 재실행되는 경우 — 브라우저 개발자 도구 콘솔에서 `[MuseTalk]` 로그가 새 요청마다 찍히는지 관찰).

Expected: **같은 문장**이 연달아 들어오면 두 번째부터는 `museTalkRequest`가 갱신되지 않아(=WS 요청이 다시 나가지 않아) 아바타가 이미 말한 문장을 또 재생하지 않는다.

- [ ] **Step 12: 시각적 판정 — C안 채택 여부**

Step 9의 화면을 보고 판단한다.

- **영상이 박스 안에 자연스러운 비율로 들어오면** → C안 채택. 다음 스텝(커밋)으로 진행.
- **잘리거나 위치가 어긋나거나 시각적으로 크게 어색하면** → 이 태스크를 **DONE_WITH_CONCERNS**로 보고하고, 스크린샷 또는 구체적 증상을 report에 남긴다. B안(별도 단순 컴포넌트) 설계는 이 계획의 범위 밖이므로 controller가 다음 단계를 판단한다.

- [ ] **Step 13: Commit**

```bash
cd job_simulator
git add apps/web/src/components/scenario/AiCoachPanel.tsx apps/web/src/pages/ScenarioGamePage.tsx apps/web/src/styles/scenarioGame.module.css
git commit -m "$(cat <<'EOF'
feat(scenario): LIVE 코치 패널에 실제 AI 아바타 연결

coachMessage 18개 갱신 지점 중 코칭 내용 7곳(안내/팁/피드백)만
speakCoach()로 교체해 아바타가 말하게 한다. 연결상태/에러 11곳은
그대로 두어 시스템 문구는 말하지 않는다. 레이아웃은 CSS 변수를
.avatarViewport에 지역 재정의해 1:1 상담 페이지 전용 컴포넌트를
그대로 재사용한다(C안).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

Expected: 새 커밋 1개 생성.

---

## Self-Review 체크리스트 (계획 작성자용, 완료됨)

1. **스펙 커버리지**: 스펙 §1(트리거 7곳/제외 11곳)→Step 5 / §2(speakCoach 동작)→Step 4 / §3(AiAvatarStage 연결)→Step 6 / §4(CSS C안)→Step 8 / §검증계획 1-4→Step 7,9-11 / 판정기준→Step 12. 전부 매핑됨.
2. **플레이스홀더 없음**: 모든 코드 블록이 실제 파일에서 확인한 정확한 현재 코드 기준 완전한 diff. Step 12의 "B안 전환"은 조건부 분기이지 미완성이 아니다(스펙에 이미 명시된 대로 controller 판단으로 넘기는 정상 경로).
3. **타입/이름 일관성**: `speakCoach(text: string): void` — Step 4에서 정의, Step 5의 7곳 모두 동일 시그니처로 호출. `handleAvatarSpeakingEnd`/`handleAvatarSpeakingError` — Step 4 정의, Step 6에서 그대로 소비. `museTalkRequest`/`avatarStatus` 타입이 `AiAvatarStage`의 props 타입과 정확히 일치(재확인 완료: `status?: AvatarStatus`, `museTalkRequest?: MuseTalkStageRequest | null`).
