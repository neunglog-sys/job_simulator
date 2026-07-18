import { useEffect, useRef, useState, type ReactNode } from "react";
import { AVATAR_IDLE_SRC } from "../../config/endpoints";
import styles from "../../styles/oneToOneConversation.module.css";
import type { AvatarStatus } from "../../types/conversation";

type AiAvatarStageProps = {
  children?: ReactNode;
  status?: AvatarStatus;
  /** 발화 HLS 재생목록(.m3u8) URL. null이면 idle 루프만 재생. */
  hlsUrl?: string | null;
  /** 발화 영상이 끝났을 때 — 호출부가 idle로 되돌리는 용도. */
  onSpeakingEnd?: () => void;
};

/**
 * idle 루프와 발화 스트림을 **겹쳐두고 opacity로 크로스페이드**한다.
 * (하나의 <video>에서 src만 갈아끼우면 로딩 중 검은 화면이 번쩍인다.)
 *
 * idle 영상은 발화와 **동일한 설정**(av6_2 512×512 / lite / seed 123 / 크롭 없음)으로 만들어
 * 구도가 100% 일치한다 → 전환할 때 얼굴이 튀지 않는다.
 */
export function AiAvatarStage({
  children,
  status = "idle",
  hlsUrl,
  onSpeakingEnd,
}: AiAvatarStageProps) {
  const speakRef = useRef<HTMLVideoElement | null>(null);
  const [speakReady, setSpeakReady] = useState(false);

  // hlsUrl이 오면 hls.js로 물려 재생. Safari는 HLS를 네이티브 지원해 hls.js가 불필요.
  useEffect(() => {
    const video = speakRef.current;
    if (!video || !hlsUrl) {
      setSpeakReady(false);
      return;
    }

    let disposed = false;
    let hls: { destroy: () => void } | null = null;

    // 발화 앞부분이 잘리는 문제 대응.
    // 서버 재생목록은 `EXT-X-PLAYLIST-TYPE:EVENT`이고 생성 중이라 계속 자란다. 이 경우 hls.js가
    // 라이브로 판단해 **라이브 엣지(최신 세그먼트)부터** 재생해버리는 알려진 이슈가 있다
    // (startPosition을 줘도 seek 호출이 누락됨 — hls.js #1400/#4950).
    // 게다가 서버는 세그먼트마다 `EXT-X-DISCONTINUITY`를 넣고 PTS도 0이 아닌 값(≈1.48)에서 시작한다.
    // → 플레이어 판단에 맡기지 않고, **버퍼의 실제 시작점으로 직접 맞춘 뒤** 재생한다.
    const seekToBufferStartThenPlay = () => {
      if (disposed) return;
      const buffered = video.buffered;
      if (buffered.length && video.currentTime > buffered.start(0) + 0.2) {
        video.currentTime = buffered.start(0);
      }
      // 발화 영상엔 TTS 오디오가 들어있다. 사용자가 전송 버튼을 눌러 자동재생 정책은 통과하지만
      // 그래도 실패할 수 있어 조용히 무시한다(음소거 폴백은 무음 발화가 되어 오히려 나쁨).
      void video.play().catch(() => undefined);
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadeddata", seekToBufferStartThenPlay, { once: true });
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = hlsUrl; // 최후 폴백
          video.addEventListener("loadeddata", seekToBufferStartThenPlay, { once: true });
          return;
        }
        const instance = new Hls({ startPosition: 0 });
        hls = instance;
        instance.loadSource(hlsUrl);
        instance.attachMedia(video);
        // 첫 조각이 실제로 버퍼에 올라온 뒤에 위치를 잡고 재생 — MANIFEST_PARSED는 너무 이르다
        instance.once(Hls.Events.FRAG_BUFFERED, seekToBufferStartThenPlay);
      });
    }

    return () => {
      disposed = true;
      hls?.destroy();
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
        {/* idle — 항상 불투명하게 깔아둔다(발화 영상이 그 위에 페이드인).
            ⚠️ idle을 같이 페이드아웃하면 중간에 둘 다 반투명해져 배경이 비친다 →
               아바타가 유령처럼 보이면서 "장면이 컷된" 느낌이 난다. 밑에 항상 하나는 불투명해야 함. */}
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
        {/* speaking — HLS. 세그먼트는 브라우저가 GPU 서버에서 직접 받아간다(백엔드 경유 X).
            onPlaying = 실제로 프레임이 그려지기 시작한 순간 → 이때만 idle에서 넘어간다. */}
        <video
          ref={speakRef}
          className={styles.avatarVideo}
          style={{ opacity: speaking ? 1 : 0 }}
          playsInline
          preload="auto"
          onPlaying={() => setSpeakReady(true)}
          onEnded={onSpeakingEnd}
          aria-hidden={!speaking}
        />
        {children}
      </div>
    </section>
  );
}
