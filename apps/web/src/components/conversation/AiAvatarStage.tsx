import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_BASE_URL } from "../../config/endpoints";
import { createAvatarWebSocket, type MuseTalkSpeakRequest } from "../../lib/api";
import {
  COACH_PROFILES,
  getStoredCoachId,
  type CoachAvatarId,
} from "../../lib/coachPreference";
import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

type MuseTalkStageRequest = MuseTalkSpeakRequest & {
  id: number;
  displayCharacters?: number;
};

/** [CLIENT-FPS] 디버그 패널 1초 스냅샷. avatarFps는 requestVideoFrameCallback으로 센
 * "실제 표시된" 프레임 수다 — rAF(UI 렌더 루프)와 다르고, 서버 목표치(frame_sync의
 * fps=25)와 직접 비교할 수 있다. */
type DebugStats = {
  at: string;
  uiFps: number;
  avatarFps: number;
  layer: "speak" | "idle";
  target: number;
  dropped: number;
  total: number;
  bufferedS: number;
};

function readDebugEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("debug")) return true;
    return window.localStorage.getItem("jobiverse-avatar-debug") === "1";
  } catch {
    return false;
  }
}

type AiAvatarStageProps = {
  children?: ReactNode;
  status?: AvatarStatus;
  volume?: number;
  avatarId?: CoachAvatarId;
  museTalkRequest?: MuseTalkStageRequest | null;
  hlsUrl?: string | null;
  onSpeakingStart?: (durationMs: number | null) => void;
  onSpeakingEnd?: () => void;
  onSpeakingError?: () => void;
  onMuseTalkMetrics?: (metrics: Record<string, unknown>) => void;
};

const MUSE_TALK_MIME = 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
/** MSE 시작 버퍼(초). 이만큼 쌓여야 첫 재생을 시작한다.
 *
 * 2026-07-23 스윕 실측(quality, 버퍼당 N=4): 2.0s→재생시작 7.79s / 1.5s→7.94s /
 * 1.0s→6.86s / 0.5s→6.78s. 2.0→1.0에서 0.93초를 얻고, 그 아래로는 0.08초뿐이라
 * (첫 프레임 도착 시각이 한계) 1.0을 채택한다.
 * ⚠️ 네 조건 모두 끊김이 관측되지 않았으나 N=4로는 끊김률을 판정할 수 없다
 *    (3/n 규칙: 0/4의 95% 상한 75%). 동시 사용자·긴 답변(420자)에서 재검증 필요.
 *    그래서 0.5가 아니라 안전 마진이 있는 1.0으로 둔다. */
const MUSE_TALK_START_BUFFER_SECONDS = 1;
const MUSE_TALK_START_BUFFER_MIN = 0.3;
const MUSE_TALK_START_BUFFER_MAX = 5;

/** stall에서 회복할 때 다시 채울 버퍼(초).
 *
 * 이게 없으면 브라우저는 프레임 몇 장(HAVE_FUTURE_DATA)만 차도 재생을 재개해 곧바로 또 멈춘다.
 * 실측에서 stall 3회가 연달아 났고 그때 buffered_ahead가 0.038~0.056초(1프레임 남짓)였다.
 * 한 번에 이만큼 모아 재개해 "여러 번 딸꾹"을 "한 번 길게"로 바꾼다. */
const MUSE_TALK_REBUFFER_SECONDS = 0.8;

/** 시작 버퍼 임계값. `?startBuffer=1.0`으로 런타임 조정한다(첫 재생 지연 스윕 측정용).
 *
 * 빈 문자열·비수치·NaN은 전부 기본값으로 떨어뜨린다. `Number("")`는 0이고 오타는 NaN인데,
 * NaN이 새면 `bufferedAhead < NaN`이 **항상 false**라 버퍼 없이 즉시 재생돼버린다 —
 * stall 위험이 가장 큰 설정으로 조용히 빠지는 것이라 반드시 막아야 한다.
 */
function resolveStartBufferSeconds(): number {
  if (typeof window === "undefined") return MUSE_TALK_START_BUFFER_SECONDS;
  try {
    const raw = new URLSearchParams(window.location.search).get("startBuffer");
    if (raw === null || raw.trim() === "") return MUSE_TALK_START_BUFFER_SECONDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return MUSE_TALK_START_BUFFER_SECONDS;
    return Math.min(
      MUSE_TALK_START_BUFFER_MAX,
      Math.max(MUSE_TALK_START_BUFFER_MIN, parsed)
    );
  } catch {
    return MUSE_TALK_START_BUFFER_SECONDS;
  }
}

/** 명시적인 화면 선택값을 우선하고, 개발용 URL 파라미터와 저장값을 차례로 확인한다. */
function resolveAvatarId(preferredAvatarId?: CoachAvatarId): CoachAvatarId {
  if (preferredAvatarId) return preferredAvatarId;
  if (typeof window === "undefined") return "male";
  try {
    const raw = new URLSearchParams(window.location.search).get("avatarId");
    if (raw === "male" || raw === "female") return raw;
    return getStoredCoachId() ?? "male";
  } catch {
    return getStoredCoachId() ?? "male";
  }
}

/** leadEstimate(요청→첫 재생 예측 지연, 초)의 저장/시드.
 *
 * 매 발화 첫 재생 실측치로 EMA 갱신하되, 그 결과를 localStorage에 저장해 **새로고침·재마운트
 * 후에도** 워밍업된 값에서 시작한다. 옛 하드코딩 2.4는 실제(~7.5s)보다 훨씬 짧아 세션 초반
 * 8발화쯤까지 머리가 튀는 원인이었다 — 시드를 실측 p50 근처로 두면 첫 발화부터 위상이 맞는다. */
const LEAD_ESTIMATE_KEY = "jobiverse-avatar-lead-estimate";
// 2026-07-27 실서버 실측(버퍼 1s · flush OFF · CRF 26), 남녀 각 N=5:
//   남성 첫재생 p50 3.977s → 시드 4.2에서 drift 0.003s  ✅
//   여성 첫재생 p50 4.175s → 시드 2.9에서 drift 최대 1.236s (EMA가 4발화에 걸쳐 따라잡음)
// → 남녀 모두 실제 lead가 4.0s대다. **코치별로 나눌 필요 없이 4.0 하나면 맞는다.**
//
// 같은 날 더 이른 측정에서는 2.87s가 나왔는데, 그건 네트워크가 더 빨랐을 때다
// (dial_ms 430ms → 이후 606~633ms로 열화된 뒤 그대로 유지). 즉 이 값은 코드 상수가
// 아니라 **그날의 경로 지연**을 반영한다.
//
// 옛값 6.5는 버퍼 2s·flush 시절 기준이라 첫 접속 브라우저마다 idle이 3.5s+ 어긋나
// 초반 발화들의 머리 점프 원인이 됐다(실측 drift −3.5s). EMA(α=0.3)는 발화당 30%씩만
// 좁혀 수렴에 ~8발화가 걸리므로, 시드가 틀리면 그동안 계속 튄다.
//
// ⚠️ 이 값은 **시작 버퍼·스트림 CRF·경로 지연과 한 세트**다. 셋 중 하나라도 바뀌면
//    실측 lead가 달라지므로 재측정해야 한다. 틀려도 EMA가 결국 수렴하니 치명적이진 않고,
//    비용은 "세션 초반 몇 발화에서 머리가 튄다" 정도다.
//    측정 근거: avatar/스크럼_0727_성능측정.md §6
const LEAD_ESTIMATE_DEFAULT = 4.0;
const LEAD_ESTIMATE_MIN = 1;
const LEAD_ESTIMATE_MAX = 12;

function readStoredLeadEstimate(): number {
  if (typeof window === "undefined") return LEAD_ESTIMATE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(LEAD_ESTIMATE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) return LEAD_ESTIMATE_DEFAULT;
    return Math.min(LEAD_ESTIMATE_MAX, Math.max(LEAD_ESTIMATE_MIN, parsed));
  } catch {
    return LEAD_ESTIMATE_DEFAULT;
  }
}

function writeStoredLeadEstimate(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEAD_ESTIMATE_KEY, String(value));
  } catch {
    // 저장소가 차단된 환경에서도 현재 세션의 갱신은 그대로 동작한다.
  }
}

export function AiAvatarStage({
  children,
  status = "idle",
  volume = 1,
  avatarId,
  museTalkRequest,
  hlsUrl,
  onSpeakingStart,
  onSpeakingEnd,
  onSpeakingError,
  onMuseTalkMetrics,
}: AiAvatarStageProps) {
  const speakRef = useRef<HTMLVideoElement | null>(null);
  const speakingStartKeyRef = useRef<string | null>(null);
  /** idle 영상. 발화와 머리 위상을 맞추려면 재생 위치를 읽고 되감아야 해서 ref가 필요하다. */
  const idleRef = useRef<HTMLVideoElement | null>(null);
  /** 요청 → 실제 재생 시작까지의 지연 추정치(초).
   *
   * 요청 시점의 idle 위치를 그대로 보내면, 재생이 시작될 즈음 idle은 이미 그만큼 앞서 있다.
   * 그때 되감으면 되감기 자체가 점프로 보이므로(문제를 옮기는 것뿐), **미래 위치를 예측해서**
   * 보낸다 → 재생 시점에 idle이 자연스럽게 그 프레임에 도달해 되감을 필요가 없다.
   * 발화마다 관측값으로 갱신한다(EMA). 시드는 localStorage에 저장된 직전 추정치(없으면
   * 실측 근처 기본값), 그래서 새로고침 후에도 워밍업된 값에서 시작한다. [[readStoredLeadEstimate]]
   */
  const leadEstimateRef = useRef(readStoredLeadEstimate());
  /** 서버가 알려준 이 발화의 시작 프레임·사이클 정보. 예측 오차를 로그로 남기는 데만 쓴다.
   *
   * 2026-07-23 감사: idle을 seek·pause 해서 위상을 "맞추려던" 시도는 오히려 튐을 만들었다.
   * 보정 seek은 speak 오버레이가 아직 투명할 때 실행돼 그대로 노출됐고, pause는 220ms
   * 페이드 구간에서 "정지한 idle + 움직이는 speak" 이중상을 만들었다. 둘 다 25fps 실시간이라
   * **건드리지 않는 것**이 가장 잘 맞는다. drift는 계속 관측만 한다.
   */
  const frameSyncRef = useRef<{ startFrame: number; fps: number; cycleLen: number } | null>(null);
  const endFrameRef = useRef<number | null>(null);

  const [speakReady, setSpeakReady] = useState(false);
  /** 평가 요구(stt·fps 가시화) 대응 — `?debug=1` 또는 localStorage
   * 'jobiverse-avatar-debug'="1"일 때만 화면 패널 + 백엔드 비콘([CLIENT-FPS])이 켜진다.
   * 같은 측정값을 둘에 함께 먹이므로 시연 녹화(화면)와 VM 로그 조회가 동시에 충족된다. */
  const [debugEnabled] = useState(readDebugEnabled);
  const [debugStats, setDebugStats] = useState<DebugStats | null>(null);
  const lastMetricsRef = useRef<Record<string, unknown> | null>(null);
  const safeVolume = Math.min(1, Math.max(0, volume));
  const resolvedAvatarId = resolveAvatarId(avatarId);
  const coach = COACH_PROFILES[resolvedAvatarId];
  const speakingMediaKey = museTalkRequest
    ? `musetalk-${museTalkRequest.id}`
    : hlsUrl
      ? `hls-${hlsUrl}`
      : null;

  useEffect(() => {
    speakingStartKeyRef.current = null;
  }, [speakingMediaKey]);

  useEffect(() => {
    if (speakRef.current) speakRef.current.volume = safeVolume;
  }, [safeVolume]);

  useEffect(() => {
    if (!debugEnabled) return;
    let disposed = false;
    let uiFrames = 0;
    let speakFrames = 0;
    let idleFrames = 0;
    let rafId = 0;
    const rafTick = () => {
      if (disposed) return;
      uiFrames += 1;
      rafId = window.requestAnimationFrame(rafTick);
    };
    rafId = window.requestAnimationFrame(rafTick);

    // rVFC는 Chrome/Edge 전용 — 미지원(Firefox 등)이면 0.5초 폴링으로 요소만 기다린다.
    // idle·speak 두 비디오 모두에 건다: idle은 상시 재생, speak는 발화 중에만 프레임을 내므로
    // "이번 1초 창에서 speak가 프레임을 냈는가"가 곧 화면에 보이는 레이어 판별이 된다.
    type RVFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const hookVideo = (get: () => HTMLVideoElement | null, bump: () => void) => {
      const tick = () => {
        if (disposed) return;
        const v = get() as RVFCVideo | null;
        if (v?.requestVideoFrameCallback) {
          v.requestVideoFrameCallback(() => {
            bump();
            tick();
          });
        } else {
          window.setTimeout(tick, 500);
        }
      };
      tick();
    };
    hookVideo(() => speakRef.current, () => { speakFrames += 1; });
    hookVideo(() => idleRef.current, () => { idleFrames += 1; });

    const interval = window.setInterval(() => {
      if (disposed) return;
      const speakVideo = speakRef.current as
        | (HTMLVideoElement & {
            getVideoPlaybackQuality?: () => {
              totalVideoFrames: number;
              droppedVideoFrames: number;
            };
          })
        | null;
      const layer: DebugStats["layer"] = speakFrames > 0 ? "speak" : "idle";
      const avatarFps = layer === "speak" ? speakFrames : idleFrames;
      const q = speakVideo?.getVideoPlaybackQuality?.();
      const bufferedS =
        speakVideo && speakVideo.buffered.length > 0
          ? Math.max(
              0,
              speakVideo.buffered.end(speakVideo.buffered.length - 1) -
                speakVideo.currentTime,
            )
          : 0;
      const target = frameSyncRef.current?.fps ?? 25;
      const stats: DebugStats = {
        at: new Date().toLocaleTimeString(),
        uiFps: uiFrames,
        avatarFps,
        layer,
        target,
        dropped: q?.droppedVideoFrames ?? 0,
        total: q?.totalVideoFrames ?? 0,
        bufferedS: Number(bufferedS.toFixed(2)),
      };
      setDebugStats(stats);
      const m = lastMetricsRef.current;
      void fetch(`${API_BASE_URL}/api/debug/client-metrics`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "avatar_fps",
          coach: resolvedAvatarId,
          actual_fps: avatarFps,
          layer,
          target_fps: target,
          ui_fps: uiFrames,
          dropped_frames: stats.dropped,
          total_frames: stats.total,
          buffered_s: stats.bufferedS,
          stall_count: typeof m?.stall_count === "number" ? m.stall_count : null,
          window: "1s",
        }),
      }).catch(() => undefined);
      uiFrames = 0;
      speakFrames = 0;
      idleFrames = 0;
    }, 1000);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearInterval(interval);
    };
  }, [debugEnabled, resolvedAvatarId]);

  useEffect(() => {
    const video = speakRef.current;
    if (!video || !hlsUrl || museTalkRequest) {
      setSpeakReady(false);
      return;
    }

    let disposed = false;

    video.muted = true;
    video.src = hlsUrl;
    const onCanPlay = () => {
      if (disposed) return;
      void video
        .play()
        .then(() => {
          if (!disposed) video.muted = false;
        })
        .catch(() => undefined);
    };
    video.addEventListener("canplay", onCanPlay, { once: true });

    return () => {
      disposed = true;
      video.removeEventListener("canplay", onCanPlay);
      video.removeAttribute("src");
      video.load();
      setSpeakReady(false);
    };
  }, [hlsUrl, museTalkRequest]);

  useEffect(() => {
    const video = speakRef.current;
    const MediaSourceClass = window.MediaSource;
    if (!video || !museTalkRequest) return;

    if (!MediaSourceClass || !MediaSourceClass.isTypeSupported(MUSE_TALK_MIME)) {
      onSpeakingError?.();
      return;
    }

    let disposed = false;
    let sourceBuffer: SourceBuffer | null = null;
    let streamDone = false;
    const queue: ArrayBuffer[] = [];
    const mediaSource = new MediaSourceClass();
    const objectUrl = URL.createObjectURL(mediaSource);
    const socket = createAvatarWebSocket();
    const startedAt = window.performance.now();
    const startBufferSeconds = resolveStartBufferSeconds();
    let firstBinaryAt: number | null = null;
    let firstPlayAt: number | null = null;
    /** 수신한 바이너리 청크 수. 청크마다 로그를 찍던 것을 대체한다(metrics로 방출). */
    let binaryCount = 0;
    // socket.onopen 시각(sinceStart). 첫 재생까지 실제 걸린 시간(firstPlay-wsOpen)이 이번
    // 발화의 실측 lead이고, 이 값으로 leadEstimateRef를 EMA 갱신한다(아래 handlePlaying).
    let wsOpenAt: number | null = null;
    let lastDonePayload: Record<string, unknown> | null = null;
    let relayTiming: Record<string, unknown> | null = null;
    let doneTotalS: number | null = null;
    let emitSeq = 0;
    let metricsEmitted = false;
    let stallCount = 0;
    let totalStallMs = 0;
    let stallStartedAt: number | null = null;
    /** 재생 게이트 계측 — `first_binary → 첫 재생` 사이를 3구간으로 쪼개기 위한 값들.
     *
     * 실측상 이 구간이 0.42초인데, 코드상으로는 최소 0.67초(GOP 1초 ÷ 페이싱 1.5배)여야 해서
     * 모순이 있다. `gatedByDone`이 참이면 버퍼가 안 찼는데 `streamDone`으로 게이트를 우회한
     * 것이므로, 짧은 발화에서만 빨랐던 것이고 긴 발화에선 훨씬 커진다는 뜻이 된다.
     * 그 판별에 필요한 값들을 콘솔이 아니라 metrics에 실어 적재한다. */
    let gatePassAt: number | null = null;
    let gatedByDone = false;
    let bufferedAheadAtGate: number | null = null;
    let playCalledAt: number | null = null;

    /** 머리 위상 동기화 상태.
     *
     * idle 영상은 코랩 페르소나의 프레임 사이클(정방향+역방향)과 1:1로 대응한다.
     * 서버는 우리가 보낸 idle 재생 위치에서 발화를 생성하고, 시작/종료 프레임을 알려준다.
     * 그 값으로 발화 직전엔 idle을 `start_frame`에 고정하고, 끝나면 `end_frame`부터 잇는다.
     * 서버가 `frame_sync`를 안 보내면(구버전) 전부 건너뛰어 기존 동작 그대로 둔다.
     */

    frameSyncRef.current = null;
    endFrameRef.current = null;

    const sinceStart = () =>
      Number(((window.performance.now() - startedAt) / 1000).toFixed(3));

    /** metrics는 여러 번 나간다(`emit_event`로 구분): done / first_play / ended / close.
     *
     * - `playIfReady()`가 done 처리 **뒤에** 호출되므로 1회만 방출하면 짧은 발화에서
     *   `first_play_at`이 구조적으로 항상 null이 된다 → 첫 재생 때 채워 다시 방출한다.
     * - `browser_total_s`는 **done 시점 값을 얼려서** 재사용한다. 매번 재계산하면
     *   나중 방출이 '스트림 완료 시각'을 '첫 재생/종료 시각'으로 덮어써
     *   소비 측 `end_to_end_avatar_done_ms`가 오염된다.
     * - 방출 시점에 **열려 있는 stall**을 회수해 합산한다. 안 그러면 tail에서 열린 채
     *   끝나는(대개 가장 긴) stall이 통째로 0으로 보고된다.
     *
     * 소비 측은 필드별로 출처 이벤트를 고정할 것: total은 done, first_play는 first_play,
     * stall은 마지막(ended/close) 방출이 가장 완전하다.
     */
    const emitMetrics = (
      emitEvent: "done" | "first_play" | "ended" | "close",
      donePayload?: Record<string, unknown>
    ) => {
      if (disposed) return;
      if (donePayload) {
        lastDonePayload = donePayload;
        doneTotalS = sinceStart();
      }
      const openStallMs =
        stallStartedAt !== null ? window.performance.now() - stallStartedAt : 0;
      emitSeq += 1;
      const metrics = {
        ...(lastDonePayload ?? {}),
        ...(relayTiming ? { relay_timing: relayTiming } : {}),
        emit_event: emitEvent,
        emit_seq: emitSeq,
        first_binary_at: firstBinaryAt,
        first_play_at: firstPlayAt,
        start_buffer_s: startBufferSeconds,
        gate_pass_at_s: gatePassAt,
        gated_by_done: gatedByDone,
        buffered_ahead_at_gate: bufferedAheadAtGate,
        play_called_at_s: playCalledAt,
        binary_count: binaryCount,
        stall_count: stallCount + (stallStartedAt !== null ? 1 : 0),
        total_stall_ms: Math.round(totalStallMs + openStallMs),
        stall_open: stallStartedAt !== null,
        browser_total_s: doneTotalS ?? sinceStart(),
        emitted_at_s: sinceStart(),
      };
      console.info("[MuseTalk]", metrics);
      lastMetricsRef.current = metrics;
      onMuseTalkMetrics?.(metrics);
      metricsEmitted = true;
    };

    /** 재생이 끝난 뒤 한 번 더 방출 — tail stall까지 닫힌 최종 스냅샷. */
    const handleEnded = () => {
      if (disposed) return;
      // idle은 발화 내내 멈추지 않았으므로 여기서 되살릴 것도, seek할 것도 없다.
      // (idle mp4는 GOP가 250프레임이라 임의 seek이 제때 반영되지 않아 오히려 튄다)
      emitMetrics("ended");
    };

    const handlePlaying = () => {
      if (disposed) return;

      if (firstPlayAt === null) {
        firstPlayAt = sinceStart();
        console.info("[MuseTalk]", "first_play_at", firstPlayAt);
        // ⚠️ 여기서 idle을 seek·pause 하지 않는다. (2026-07-23 감사)
        //  - 이 시점의 speak 오버레이는 아직 opacity 0이다(speakReady→setState→220ms 페이드).
        //    따라서 "speak가 덮고 있어 안 보인다"는 전제가 틀렸고, 보정 seek이 그대로 노출된다.
        //  - idle을 멈추면 페이드 220ms 동안 "정지한 idle + 움직이는 speak"가 합성돼 이중상이 된다.
        //  - speak·idle 모두 25fps 실시간이라, 멈추지만 않으면 위상이 저절로 유지된다.
        // 예측 오차는 로그로만 남겨 데이터를 모은다(보정은 하지 않는다).
        const idle = idleRef.current;
        const sync = frameSyncRef.current;
        if (sync && idle) {
          const cycleSeconds = sync.cycleLen / sync.fps;
          const expected = sync.startFrame / sync.fps;
          const raw = idle.currentTime - expected;
          const drift =
            cycleSeconds > 0
              ? ((raw % cycleSeconds) + cycleSeconds * 1.5) % cycleSeconds - cycleSeconds / 2
              : raw;
          console.info("[MuseTalk]", "idle_drift", {
            ...sync,
            drift_s: Number(drift.toFixed(3)),
            first_play_at: firstPlayAt,
          });
        }
        // leadEstimate 보정(위상 동기화 핵심): 이번 발화의 실측 lead = 첫 재생 − onopen.
        // EMA로 수렴시켜 다음 발화의 idle 위치 예측을 실제 첫재생 지연(현재 ~5–9s)에 맞춘다.
        // 고정값 2.4는 실제보다 훨씬 짧아 idle이 5–7s 앞서 흘러 발화 시작 때 머리가 튀는
        // 원인이었다(주석엔 EMA 갱신이라 돼 있었으나 실제 갱신 코드가 없었음).
        if (wsOpenAt !== null) {
          const observedLead = firstPlayAt - wsOpenAt;
          if (Number.isFinite(observedLead) && observedLead > 0) {
            const EMA_ALPHA = 0.3;
            const next =
              EMA_ALPHA * observedLead + (1 - EMA_ALPHA) * leadEstimateRef.current;
            // 콜드/이상치 폭주 방지 클램프. 결과를 저장해 다음 세션도 워밍업 상태로 시작한다.
            leadEstimateRef.current = Math.min(
              LEAD_ESTIMATE_MAX,
              Math.max(LEAD_ESTIMATE_MIN, next)
            );
            writeStoredLeadEstimate(leadEstimateRef.current);
            console.info("[MuseTalk]", "lead_estimate_update", {
              observed_lead: Number(observedLead.toFixed(3)),
              lead_estimate: Number(leadEstimateRef.current.toFixed(3)),
            });
          }
        }
        if (metricsEmitted) emitMetrics("first_play");
        return;
      }

      if (stallStartedAt !== null) {
        const durationMs = window.performance.now() - stallStartedAt;
        stallStartedAt = null;
        stallCount += 1;
        totalStallMs += durationMs;
        console.info("[MuseTalk]", "stall_end", {
          duration_ms: Math.round(durationMs),
          stall_count: stallCount,
        });
      }
    };

    /** MSE에서는 `stalled`가 안 뜨는 경우가 많아 `waiting`이 주 신호다.
     *  첫 재생 **전**의 waiting은 stall이 아니라 시작 버퍼 대기이므로 세지 않는다. */
    const handleWaiting = () => {
      if (disposed || firstPlayAt === null || stallStartedAt !== null) return;
      stallStartedAt = window.performance.now();
      // 브라우저가 프레임 한두 장에 재생을 재개해 곧바로 또 멈추는 것을 막는다.
      // 명시적으로 세워두고, playIfReady가 리버퍼 임계값을 채웠을 때만 다시 튼다.
      //
      // ⚠️ streamDone이면 절대 멈추지 않는다. playIfReady를 부르는 곳은 updateend·done·
      //    onclose 셋뿐이고 셋 다 스트림이 끝나면 다시 오지 않는다. 그 뒤에 세워버리면
      //    깨울 주체가 없어 ended가 안 뜨고 → onSpeakingEnd 미호출 → 아바타가 speaking에
      //    갇혀 이후 답변이 큐에만 쌓인다. 어차피 남은 데이터는 전부 버퍼에 있으므로
      //    "더 받을 때까지 기다린다"는 이 pause의 목적 자체가 성립하지 않는다.
      //    (브라우저의 gap jumping에 맡기는 편이 안전하다)
      if (!streamDone) {
        try {
          video.pause();
        } catch {
          // 이미 정지 상태면 무시한다.
        }
      }
      const bufferedAhead =
        video.buffered.length > 0
          ? video.buffered.end(video.buffered.length - 1) - video.currentTime
          : 0;
      console.info("[MuseTalk]", "stall_begin", {
        at_s: sinceStart(),
        buffered_ahead: Number(bufferedAhead.toFixed(3)),
      });
    };

    const endIfPossible = () => {
      if (
        disposed ||
        !streamDone ||
        queue.length > 0 ||
        sourceBuffer?.updating ||
        mediaSource.readyState !== "open"
      ) {
        return;
      }

      try {
        mediaSource.endOfStream();
      } catch {
        // 이미 닫힌 스트림이면 무시한다.
      }
    };

    const playIfReady = () => {
      if (disposed || !video.paused || video.buffered.length === 0) return;

      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const bufferedAhead = bufferedEnd - video.currentTime;
      // 첫 재생은 시작 버퍼, stall 회복은 리버퍼 임계값을 쓴다.
      // 리버퍼는 시작 버퍼보다 클 수 없게 클램프한다 — ?startBuffer=0.5 처럼 측정용으로
      // 시작 버퍼를 낮추면 회복 조건(0.8s)이 시작 조건보다 엄격해지는 역전을 막는다.
      const isFirstPlay = firstPlayAt === null;
      const gateSeconds = isFirstPlay
        ? startBufferSeconds
        : Math.min(MUSE_TALK_REBUFFER_SECONDS, startBufferSeconds);
      if (bufferedAhead < gateSeconds && !streamDone) return;

      // 계측 필드는 첫 재생 게이트만 기록한다. 리버퍼 통과가 덮어쓰면 ended/close
      // metrics의 gate_pass_at_s가 "첫 재생 조건이 충족된 시각"이 아니게 된다.
      if (isFirstPlay) {
        gatePassAt = sinceStart();
        gatedByDone = bufferedAhead < gateSeconds;
        bufferedAheadAtGate = Number(bufferedAhead.toFixed(3));
      }
      console.info("[MuseTalk]", "start_playback_buffer", {
        buffered_ahead: Number(bufferedAhead.toFixed(3)),
        gate_kind: isFirstPlay ? "start" : "rebuffer",
        threshold_s: gateSeconds,
        at_s: sinceStart(),
        gated_by_done: bufferedAhead < gateSeconds,
      });
      video.muted = true;
      if (isFirstPlay) playCalledAt = sinceStart();
      void video
        .play()
        .then(() => {
          if (!disposed) video.muted = false;
        })
        .catch(() => undefined);
    };

    const drainQueue = () => {
      if (!sourceBuffer || sourceBuffer.updating || mediaSource.readyState !== "open") return;

      const next = queue.shift();
      if (!next) {
        endIfPossible();
        return;
      }

      try {
        sourceBuffer.appendBuffer(next);
      } catch {
        onSpeakingError?.();
      }
    };

    const pushChunk = (chunk: ArrayBuffer) => {
      if (disposed || chunk.byteLength === 0) return;
      if (firstBinaryAt === null) {
        firstBinaryAt = Number(((window.performance.now() - startedAt) / 1000).toFixed(3));
        console.info("[MuseTalk]", "first_binary_at", firstBinaryAt);
      }
      queue.push(chunk);
      drainQueue();
    };

    const handleUpdateEnd = () => {
      playIfReady();
      drainQueue();
    };

    const handleSourceOpen = () => {
      if (disposed) return;

      try {
        sourceBuffer = mediaSource.addSourceBuffer(MUSE_TALK_MIME);
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", handleUpdateEnd);
        drainQueue();
      } catch {
        onSpeakingError?.();
      }
    };

    setSpeakReady(false);
    video.muted = true;
    video.src = objectUrl;
    socket.binaryType = "arraybuffer";
    mediaSource.addEventListener("sourceopen", handleSourceOpen);
    // <video>는 요청마다 재사용되므로 cleanup에서 반드시 해제한다.
    // 안 하면 다음 요청이 이전 startedAt 기준의 오염된 값을 남긴다.
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("ended", handleEnded);

    socket.onopen = () => {
      const {
        id: _id,
        displayCharacters: _displayCharacters,
        ...payload
      } = museTalkRequest;
      // idle의 **재생 시작 시점 예상 위치**를 보낸다. 지금 위치를 그대로 보내면 생성·전송에
      // 걸리는 시간만큼 idle이 앞서가 어긋나고, 그걸 되감으면 그 되감기가 점프로 보인다.
      const idle = idleRef.current;
      // 예측 기준 시각을 기록: 첫 재생 때 (firstPlay - wsOpen)이 곧 이번 발화의 실측 lead다.
      wsOpenAt = sinceStart();
      const idleTime =
        idle && Number.isFinite(idle.currentTime)
          ? Number((idle.currentTime + leadEstimateRef.current).toFixed(3))
          : 0;
      console.info("[MuseTalk]", "ws_open", { ...payload, idle_time: idleTime });
      socket.send(
        JSON.stringify({
          speaker_id: "coach",
          avatar_id: resolvedAvatarId,
          emotion: "neutral",
          idle_time: idleTime,
          ...payload,
        })
      );
    };

    socket.onmessage = (event) => {
      if (disposed) return;

      if (typeof event.data === "string") {
        type AvatarMessage = {
          type?: string;
          status?: string;
          stage?: string;
          start_frame?: number;
          end_frame?: number;
          fps?: number;
          cycle_len?: number;
        };
        let payload: AvatarMessage;
        try {
          payload = JSON.parse(event.data) as AvatarMessage;
        } catch {
          return;
        }

        // 백엔드 릴레이가 첫 바이너리 직후 주입하는 계측 프레임.
        // 브라우저/백엔드/코랩 시계가 서로 달라 로그 대조로는 못 잇기 때문에,
        // 백엔드 구간값을 스트림에 실어 보내 metrics 한 객체에 3계층을 모은다.
        if (payload.type === "relay_timing") {
          relayTiming = payload as Record<string, unknown>;
          console.info("[MuseTalk]", "relay_timing", payload);
          return;
        }

        // 서버가 실제로 어느 프레임부터 생성했는지 통지. fps가 0이면 나눗셈이 깨지므로 거른다.
        if (payload.type === "frame_sync") {
          const fps = Number(payload.fps);
          const startFrame = Number(payload.start_frame);
          const cycleLen = Number(payload.cycle_len);
          if (
            Number.isFinite(fps) && fps > 0 &&
            Number.isFinite(startFrame) &&
            Number.isFinite(cycleLen) && cycleLen > 0
          ) {
            frameSyncRef.current = { startFrame, fps, cycleLen };
            console.info("[MuseTalk]", "frame_sync", payload);
          }
          return;
        }

        const signals = [payload.type, payload.status, payload.stage];
        console.info("[MuseTalk]", "ws_text", payload);
        if (
          signals.some((signal) =>
            signal === "done" || signal === "end" || signal === "completed"
          )
        ) {
          if (Number.isFinite(Number(payload.end_frame))) {
            endFrameRef.current = Number(payload.end_frame);
          }
          emitMetrics("done", payload as Record<string, unknown>);
          streamDone = true;
          playIfReady();
          endIfPossible();
        } else if (signals.includes("error")) {
          onSpeakingError?.();
        }
        return;
      }

      // 청크마다 console.info를 찍던 것을 카운터로 바꿨다(2026-07-27).
      // 발화 1건이 300~700청크라 DevTools가 열려 있으면 그만큼 메인 스레드를 먹고,
      // 콘솔이 도배돼 정작 봐야 할 [PERF]·[SYNC] 줄을 찾기 어려웠다.
      // 총량은 metrics의 binary_count로 남으므로 정보 손실은 없다.
      //
      // ⚠️ 이 로그 제거가 첫 프레임을 앞당기지는 **않는다**. 릴레이의 first_binary_ms는
      //    send보다 앞에서 찍히므로(service.py:627 < :629) N번째 로그가 N번째 마크를
      //    늦출 수 없다. 첫 재생 이후 구간의 실비용만 줄어든다.
      if (event.data instanceof Blob) {
        binaryCount += 1;
        void event.data.arrayBuffer().then(pushChunk);
      } else if (event.data instanceof ArrayBuffer) {
        binaryCount += 1;
        pushChunk(event.data);
      }
    };

    socket.onerror = (event) => {
      console.error("[MuseTalk]", "ws_error", event);
      if (!disposed) onSpeakingError?.();
    };

    socket.onclose = (event) => {
      if (disposed) return;
      console.info("[MuseTalk]", "ws_close", {
        code: event.code,
        reason: event.reason,
        streamDone,
        firstBinaryAt,
      });
      if (!streamDone && event.code !== 1000) onSpeakingError?.();
      streamDone = true;
      playIfReady();
      endIfPossible();
      // done 없이 닫히는 경로에서도 baseline 표본이 유실되지 않게 방출한다.
      if (!metricsEmitted) emitMetrics("close");
    };

    return () => {
      disposed = true;
      // idle은 애초에 멈추지 않으므로 복구할 것이 없다.
      socket.close();
      sourceBuffer?.removeEventListener("updateend", handleUpdateEnd);
      mediaSource.removeEventListener("sourceopen", handleSourceOpen);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("ended", handleEnded);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      setSpeakReady(false);
    };
  }, [museTalkRequest, onMuseTalkMetrics, onSpeakingError, resolvedAvatarId]);

  const speaking =
    status === "speaking" && Boolean(hlsUrl || museTalkRequest) && speakReady;


  return (
    <section
      className={styles.avatarStage}
      data-avatar-status={status}
      aria-label="AI 직무 마스터 화면"
    >
      <div className={styles.avatarAmbientLight} aria-hidden="true" />

      <div className={styles.avatarContent}>
        {coach.idleVideoSrc ? (
          <video
            ref={idleRef}
            className={styles.avatarVideo}
            src={coach.idleVideoSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
          />
        ) : (
          <img
            className={styles.avatarVideo}
            src={coach.portraitSrc}
            alt=""
            aria-hidden="true"
          />
        )}
        <video
          ref={speakRef}
          className={styles.avatarVideo}
          style={{ opacity: speaking ? 1 : 0 }}
          playsInline
          preload="auto"
          onPlaying={(event) => {
            const video = event.currentTarget;
            video.volume = safeVolume;
            video.muted = false;
            setSpeakReady(true);
            if (
              speakingMediaKey &&
              speakingStartKeyRef.current !== speakingMediaKey
            ) {
              speakingStartKeyRef.current = speakingMediaKey;
              const remainingSeconds =
                Number.isFinite(video.duration) && video.duration > video.currentTime
                  ? video.duration - video.currentTime
                  : null;
              onSpeakingStart?.(
                remainingSeconds === null ? null : Math.round(remainingSeconds * 1000),
              );
            }
          }}
          onEnded={onSpeakingEnd}
          aria-hidden={!speaking}
        />
        {debugEnabled && debugStats && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              zIndex: 50,
              background: "rgba(10, 10, 25, 0.72)",
              color: "#d9e2ff",
              font: "11px/1.55 Consolas, monospace",
              padding: "6px 9px",
              borderRadius: 6,
              pointerEvents: "none",
              whiteSpace: "pre",
            }}
          >
            {[
              `[${debugStats.at}]`,
              `UI FPS      ${debugStats.uiFps}`,
              `Avatar FPS  ${debugStats.avatarFps} / target ${debugStats.target} (${debugStats.layer})`,
              `Dropped     ${debugStats.dropped} / ${debugStats.total}`,
              `Buffer      ${debugStats.bufferedS}s · Stalls ${
                typeof lastMetricsRef.current?.stall_count === "number"
                  ? lastMetricsRef.current.stall_count
                  : 0
              }`,
              `TTS         ${lastMetricsRef.current?.tts_seconds ?? "-"}s · Gate ${
                lastMetricsRef.current?.gate_pass_at_s ?? "-"
              }s`,
              "STT         (미연동 — 담당자 훅 대기)",
            ].join("\n")}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
