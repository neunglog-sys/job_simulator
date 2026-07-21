import { useEffect, useRef, useState, type ReactNode } from "react";
import { AVATAR_IDLE_SRC } from "../../config/endpoints";
import { createAvatarWebSocket, type MuseTalkSpeakRequest } from "../../lib/api";
import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

type MuseTalkStageRequest = MuseTalkSpeakRequest & { id: number };

type AiAvatarStageProps = {
  children?: ReactNode;
  status?: AvatarStatus;
  museTalkRequest?: MuseTalkStageRequest | null;
  hlsUrl?: string | null;
  onSpeakingEnd?: () => void;
  onSpeakingError?: () => void;
  onMuseTalkMetrics?: (metrics: Record<string, unknown>) => void;
};

const MUSE_TALK_MIME = 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
const MUSE_TALK_START_BUFFER_SECONDS = 2;

export function AiAvatarStage({
  children,
  status = "idle",
  museTalkRequest,
  hlsUrl,
  onSpeakingEnd,
  onSpeakingError,
  onMuseTalkMetrics,
}: AiAvatarStageProps) {
  const speakRef = useRef<HTMLVideoElement | null>(null);
  const [speakReady, setSpeakReady] = useState(false);

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
    let firstBinaryAt: number | null = null;

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
      if (bufferedAhead < MUSE_TALK_START_BUFFER_SECONDS && !streamDone) return;

      console.info("[MuseTalk]", "start_playback_buffer", bufferedAhead.toFixed(3));
      video.muted = true;
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

    socket.onopen = () => {
      const { id: _id, ...payload } = museTalkRequest;
      console.info("[MuseTalk]", "ws_open", payload);
      socket.send(JSON.stringify({ speaker_id: "coach", emotion: "neutral", ...payload }));
    };

    socket.onmessage = (event) => {
      if (disposed) return;

      if (typeof event.data === "string") {
        let payload: { type?: string; status?: string; stage?: string };
        try {
          payload = JSON.parse(event.data) as {
            type?: string;
            status?: string;
            stage?: string;
          };
        } catch {
          return;
        }

        const signals = [payload.type, payload.status, payload.stage];
        console.info("[MuseTalk]", "ws_text", payload);
        if (
          signals.some((signal) =>
            signal === "done" || signal === "end" || signal === "completed"
          )
        ) {
          const metrics = {
            ...payload,
            first_binary_at: firstBinaryAt,
            browser_total_s: Number(((window.performance.now() - startedAt) / 1000).toFixed(3)),
          };
          console.info("[MuseTalk]", metrics);
          onMuseTalkMetrics?.(metrics);
          streamDone = true;
          playIfReady();
          endIfPossible();
        } else if (signals.includes("error")) {
          onSpeakingError?.();
        }
        return;
      }

      if (event.data instanceof Blob) {
        console.info("[MuseTalk]", "ws_blob", event.data.size);
        void event.data.arrayBuffer().then(pushChunk);
      } else if (event.data instanceof ArrayBuffer) {
        console.info("[MuseTalk]", "ws_arraybuffer", event.data.byteLength);
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
    };

    return () => {
      disposed = true;
      socket.close();
      sourceBuffer?.removeEventListener("updateend", handleUpdateEnd);
      mediaSource.removeEventListener("sourceopen", handleSourceOpen);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      setSpeakReady(false);
    };
  }, [museTalkRequest, onMuseTalkMetrics, onSpeakingError]);

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
        <video
          className={styles.avatarVideo}
          src={AVATAR_IDLE_SRC}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <video
          ref={speakRef}
          className={styles.avatarVideo}
          style={{ opacity: speaking ? 1 : 0 }}
          playsInline
          preload="auto"
          onPlaying={(event) => {
            event.currentTarget.muted = false;
            setSpeakReady(true);
          }}
          onEnded={onSpeakingEnd}
          aria-hidden={!speaking}
        />
        {children}
      </div>
    </section>
  );
}
