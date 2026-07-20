import { useEffect, useRef, useState, type ReactNode } from "react";
import { AVATAR_IDLE_SRC } from "../../config/endpoints";
import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

type AiAvatarStageProps = {
  children?: ReactNode;
  status?: AvatarStatus;
  /**
   * 발화 스트림 URL. 백엔드가 Colab HLS를 **하나의 연속 fragmented MP4**로 재인코딩해 주는
   * `/api/avatar/stream/<id>` 엔드포인트. `<video src>`로 **네이티브 프로그레시브 재생**한다
   * (hls.js 불필요 — hls.js 라이브 재생목록의 "처음부터 다시 트는" 꼬임이 원천적으로 없다).
   * null이면 idle 루프만.
   */
  hlsUrl?: string | null;
  /** 발화 영상이 끝났을 때 — 호출부가 idle로 되돌리는 용도. */
  onSpeakingEnd?: () => void;
};

/**
 * idle 루프와 발화 스트림을 겹쳐두고 opacity로 크로스페이드한다.
 *
 * 발화 스트림은 백엔드가 SoulX 출력을 하나의 연속 MP4로 재인코딩한 것이라 세그먼트 경계에서
 * 끊기지 않는다. 브라우저가 스트림을 받는 대로 프로그레시브로 재생하므로 **시작이 빠르고**
 * (완성 대기 없음) hls.js 없이 **안정적**이다. idle 영상은 항상 맨 밑에 불투명하게 깔려,
 * 발화 레이어가 투명할 때(대기/종료)만 보인다.
 */
export function AiAvatarStage({
  children,
  status = "idle",
  hlsUrl,
  onSpeakingEnd,
}: AiAvatarStageProps) {
  const speakRef = useRef<HTMLVideoElement | null>(null);
  const [speakReady, setSpeakReady] = useState(false);

  useEffect(() => {
    const video = speakRef.current;
    if (!video || !hlsUrl) {
      setSpeakReady(false);
      return;
    }

    let disposed = false;

    // 발화 영상엔 TTS 오디오가 있다. speak가 오래 걸려 사용자 제스처 유효시간이 만료되면
    // "소리 있는 자동재생"이 차단되므로, **음소거로 시작(항상 허용)** 후 재생되면 음소거를 푼다.
    video.muted = true;
    video.src = hlsUrl; // 연속 fragmented MP4 — 브라우저가 프로그레시브로 재생
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
  }, [hlsUrl]);

  const speaking = status === "speaking" && Boolean(hlsUrl) && speakReady;

  return (
    <section
      className={styles.avatarStage}
      data-avatar-status={status}
      aria-label="AI 직무 마스터 화면"
    >
      <div className={styles.avatarAmbientLight} aria-hidden="true" />

      <div className={styles.avatarContent}>
        {/* idle — 항상 맨 밑에 불투명하게. 발화 레이어가 투명할 때만 보인다. */}
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
        {/* 발화 — 백엔드 연속 MP4 스트림. onPlaying = 실제 프레임이 그려지는 순간 → 이때 넘어간다. */}
        <video
          ref={speakRef}
          className={styles.avatarVideo}
          style={{ opacity: speaking ? 1 : 0 }}
          playsInline
          preload="auto"
          onPlaying={(e) => {
            e.currentTarget.muted = false; // 자동재생용 음소거 해제 → TTS 소리
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
