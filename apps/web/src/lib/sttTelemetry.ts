import { API_BASE_URL } from "../config/endpoints";

/**
 * STT 계측 비콘 — Web Speech 인식이 브라우저 안에서만 일어나 VM `docker compose logs`로는
 * 동작 여부조차 안 보인다(0728 채널 감사). 평가 요구사항에 stt가 있어, 최종 확정 시점에
 * 한 번 쏘면 서버가 `[STT] event=final ms=... text=...` 한 줄로 바꿔 다른 채널
 * (`[LLM-USAGE]`·`[TTS]`·`[RELAY-TIMING]`)과 같은 터미널에 흘려준다.
 *
 * 수신부는 팀원 커밋 `ab06f85`의 `POST /api/debug/client-metrics`이며 `kind:"stt"`일 때
 * `event`·`ms`·`text`만 읽는다(원문은 서버가 80자로 끊는다).
 *
 * ⚠️ 인식된 발화가 서버 로그에 남는다. 시연·평가 증빙이 목적이라 항상 켜 두지만,
 *    운영으로 넘어간다면 노출 범위를 다시 판단해야 한다.
 */

const ENDPOINT = `${API_BASE_URL}/api/debug/client-metrics`;

/** 발화 구간의 시작 시각. 첫 interim에서 찍고 final에서 소비한다. */
export type SttSegmentClock = { startedAt: number | null };

export function createSttClock(): SttSegmentClock {
  return { startedAt: null };
}

/** interim이 들어올 때마다 호출 — 구간의 첫 신호만 시작 시각으로 잡는다. */
export function markSttSegmentStart(clock: SttSegmentClock): void {
  if (clock.startedAt === null) clock.startedAt = performance.now();
}

/**
 * 최종 문장이 확정된 순간 한 번 호출.
 *
 * `ms`는 **그 구간의 첫 신호(첫 interim) → 확정**까지다. Web Speech는 발화가 끝나야
 * 확정하므로 이 값에는 말한 시간이 포함된다 — "인식기가 문장을 확정하기까지 걸린 시간"으로
 * 읽어야 하고, 순수 인식 연산 지연으로 읽으면 안 된다. 그 둘을 가르는 신호는 Web Speech가
 * 주지 않는다.
 *
 * 첫 신호를 못 잡았으면(= interim 없이 바로 확정) ms를 생략한다. 0을 보내면 "즉시 인식"으로
 * 오독되기 때문이다.
 */
export function reportSttFinal(clock: SttSegmentClock, text: string): void {
  const startedAt = clock.startedAt;
  clock.startedAt = null; // 다음 구간을 위해 비운다

  const payload: { kind: "stt"; event: "final"; text: string; ms?: number } = {
    kind: "stt",
    event: "final",
    text,
  };
  if (startedAt !== null) payload.ms = Math.round(performance.now() - startedAt);

  send(payload);
}

function send(payload: object): void {
  // 계측이 대화를 방해하면 안 된다 — 실패는 전부 삼킨다.
  try {
    const body = JSON.stringify(payload);
    // sendBeacon은 페이지가 닫혀도 전송이 보장된다. Blob 타입을 application/json으로 줘야
    // 서버의 request.json()이 그대로 읽는다.
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) {
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 계측 실패는 무시 */
  }
}
