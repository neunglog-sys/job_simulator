import {
  CircleNotch,
  ChatTeardropText,
  ListChecks,
  Microphone,
  NotePencil,
  PaperPlaneTilt,
  Stop,
  UserCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RecordingState } from "../../types/conversation";
import styles from "../../styles/scenarioGame.module.css";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const VOICE_LEVEL_THRESHOLD = 0.025;
const VOICE_START_GRACE_MS = 1_400;
const VOICE_SILENCE_TIMEOUT_MS = 2_800;

type ScenarioControlPanelProps = {
  npcName: string;
  npcRole?: string;
  npcMessage: string;
  userMessage: string;
  isStreaming?: boolean;
  isHistoryOpen?: boolean;
  isMemoOpen?: boolean;
  isWorkflowOpen?: boolean;
  disabled?: boolean;
  focusInput?: boolean;
  placeholder?: string;
  /** 입력이 막힌 이유 — 서버 문제인지 '지금은 입력할 때가 아닌지'를 구분해 보여준다. */
  disabledHint?: string;
  onSend: (message: string) => void;
  onHistoryToggle: () => void;
  onMemoOpen: () => void;
  onWorkflowOpen: () => void;
};

export function ScenarioControlPanel({
  npcName,
  npcRole,
  npcMessage,
  userMessage,
  isStreaming = false,
  isHistoryOpen = false,
  isMemoOpen = false,
  isWorkflowOpen = false,
  disabled = false,
  focusInput = false,
  placeholder = "NPC에게 보낼 답변을 입력하세요",
  disabledHint = "게임 서버에 연결 중이에요…",
  onSend,
  onHistoryToggle,
  onMemoOpen,
  onWorkflowOpen,
}: ScenarioControlPanelProps) {
  const [draft, setDraft] = useState("");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [voiceIssue, setVoiceIssue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceAnimationFrameRef = useRef<number | null>(null);
  const voiceProcessingTimerRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const voiceInputEnabledRef = useRef(!disabled);
  const voiceInputBaseRef = useRef("");
  const voiceFinalTranscriptRef = useRef("");

  // 스트리밍 중 백엔드 정리 전에 잠깐 새어나올 수 있는 화자 태그("[이름] ")를 표시 단계에서도 제거.
  const displayNpcMessage = npcMessage.replace(/^\s*\[[^\]]{1,20}\]\s*/, "");

  const cleanupVoiceResources = useCallback(() => {
    if (voiceAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }

    voiceSourceRef.current?.disconnect();
    voiceSourceRef.current = null;

    const audioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }, []);

  const finishVoiceSession = useCallback(
    (showProcessing = true) => {
      const hadActiveSession = voiceSessionActiveRef.current;
      voiceSessionActiveRef.current = false;

      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.stop();
        } catch {
          recognition.abort();
        }
      }

      cleanupVoiceResources();

      if (!hadActiveSession) return;

      if (voiceProcessingTimerRef.current !== null) {
        window.clearTimeout(voiceProcessingTimerRef.current);
      }

      if (!showProcessing) {
        setRecordingState("idle");
        return;
      }

      setRecordingState("processing");
      voiceProcessingTimerRef.current = window.setTimeout(() => {
        setRecordingState("idle");
        voiceProcessingTimerRef.current = null;
        inputRef.current?.focus();
      }, 450);
    },
    [cleanupVoiceResources],
  );

  useEffect(() => {
    if (!focusInput || disabled) return;
    inputRef.current?.focus();
  }, [disabled, focusInput]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [displayNpcMessage, isStreaming, userMessage]);

  useEffect(() => {
    voiceInputEnabledRef.current = !disabled;
    if (disabled && voiceSessionActiveRef.current) finishVoiceSession(false);
  }, [disabled, finishVoiceSession]);

  useEffect(() => {
    return () => {
      voiceSessionActiveRef.current = false;
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      cleanupVoiceResources();
      if (voiceProcessingTimerRef.current !== null) {
        window.clearTimeout(voiceProcessingTimerRef.current);
      }
    };
  }, [cleanupVoiceResources]);

  const handleVoiceInput = useCallback(async () => {
    if (recordingState === "recording") {
      finishVoiceSession();
      return;
    }

    if (recordingState !== "idle" || disabled) return;

    setVoiceIssue(null);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setVoiceIssue("음성 입력은 localhost 또는 HTTPS 주소에서 사용할 수 있어요.");
      return;
    }

    const SpeechRecognitionClass = (
      window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }
    ).SpeechRecognition ??
      (
        window as typeof window & {
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setVoiceIssue("이 브라우저는 실시간 음성 인식을 지원하지 않아요. Chrome 또는 Edge를 사용해주세요.");
      return;
    }

    setRecordingState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!voiceInputEnabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingState("idle");
        return;
      }
      voiceStreamRef.current = stream;
      voiceSessionActiveRef.current = true;
      voiceInputBaseRef.current = draft.trim();
      voiceFinalTranscriptRef.current = "";
      setRecordingState("recording");

      const recognition = new SpeechRecognitionClass();
      recognition.lang = "ko-KR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interimTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim() ?? "";
          if (!transcript) continue;
          if (result.isFinal) {
            voiceFinalTranscriptRef.current = [voiceFinalTranscriptRef.current, transcript]
              .filter(Boolean)
              .join(" ");
          } else {
            interimTranscript = [interimTranscript, transcript].filter(Boolean).join(" ");
          }
        }

        setDraft(
          [voiceInputBaseRef.current, voiceFinalTranscriptRef.current, interimTranscript]
            .filter(Boolean)
            .join(" "),
        );
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted") return;

        const issue =
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "브라우저 주소창의 마이크 권한을 허용해주세요."
            : event.error === "audio-capture"
              ? "사용 가능한 마이크를 찾지 못했어요."
              : event.error === "network"
                ? "음성 인식 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요."
                : event.error === "no-speech"
                  ? "음성이 들리지 않아 녹음을 종료했어요."
                  : "음성 인식 중 오류가 발생했어요. 다시 시도해주세요.";

        setVoiceIssue(issue);
        finishVoiceSession(false);
      };
      recognition.onend = () => {
        if (voiceSessionActiveRef.current) finishVoiceSession();
      };
      speechRecognitionRef.current = recognition;
      recognition.start();

      const AudioContextClass =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const startedAt = window.performance.now();
        let lastSoundAt = startedAt;

        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.78;
        const samples = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        voiceAudioContextRef.current = audioContext;
        voiceSourceRef.current = source;
        void audioContext.resume().catch(() => undefined);

        const measureVoiceLevel = () => {
          if (!voiceSessionActiveRef.current) return;

          analyser.getByteTimeDomainData(samples);
          let total = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            total += normalized * normalized;
          }

          const rms = Math.sqrt(total / samples.length);
          const now = window.performance.now();

          if (rms >= VOICE_LEVEL_THRESHOLD) {
            lastSoundAt = now;
          } else if (
            now - startedAt >= VOICE_START_GRACE_MS &&
            now - lastSoundAt >= VOICE_SILENCE_TIMEOUT_MS
          ) {
            finishVoiceSession();
            return;
          }

          voiceAnimationFrameRef.current = window.requestAnimationFrame(measureVoiceLevel);
        };

        voiceAnimationFrameRef.current = window.requestAnimationFrame(measureVoiceLevel);
      }
    } catch (error) {
      voiceSessionActiveRef.current = false;
      cleanupVoiceResources();
      setRecordingState("idle");
      const errorName = error instanceof DOMException ? error.name : "";
      setVoiceIssue(
        errorName === "NotAllowedError" || errorName === "SecurityError"
          ? "브라우저 주소창의 마이크 권한을 허용해주세요."
          : errorName === "NotFoundError"
            ? "사용 가능한 마이크를 찾지 못했어요."
            : errorName === "NotReadableError"
              ? "마이크를 다른 프로그램에서 사용 중인지 확인해주세요."
              : "마이크를 시작하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
  }, [cleanupVoiceResources, disabled, draft, finishVoiceSession, recordingState]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || disabled) return;

    if (voiceSessionActiveRef.current) finishVoiceSession(false);
    onSend(message);
    setDraft("");
  };

  return (
    <div className={styles.dialogueHudGroup}>
      <div className={styles.dialogueUtilityBar} aria-label="대화 보조 기능">
        <button
          className={`${styles.dialogueUtilityButton} ${isHistoryOpen ? styles.dialogueUtilityButtonActive : ""}`}
          type="button"
          onClick={onHistoryToggle}
          aria-label={isHistoryOpen ? "이전 대화 닫기" : "이전 대화 보기"}
          aria-expanded={isHistoryOpen}
        >
          <ChatTeardropText weight={isHistoryOpen ? "fill" : "bold"} aria-hidden="true" />
          <span>이전 대화 보기</span>
        </button>
        <button
          className={`${styles.dialogueUtilityButton} ${isMemoOpen ? styles.dialogueUtilityButtonActive : ""}`}
          type="button"
          onClick={onMemoOpen}
          aria-label={isMemoOpen ? "메모장 닫기" : "메모하기"}
          aria-expanded={isMemoOpen}
        >
          <NotePencil weight="bold" aria-hidden="true" />
          <span>메모하기</span>
        </button>
        <button
          className={`${styles.dialogueUtilityButton} ${isWorkflowOpen ? styles.dialogueUtilityButtonActive : ""}`}
          type="button"
          onClick={onWorkflowOpen}
          aria-label={isWorkflowOpen ? "업무 프로세스 닫기" : "업무 프로세스 보기"}
          aria-expanded={isWorkflowOpen}
        >
          <ListChecks weight="bold" aria-hidden="true" />
          <span>업무 프로세스 보기</span>
        </button>
      </div>

      <section className={`${styles.glassPanel} ${styles.dialoguePanel}`} aria-label="NPC 대화창">
        <div className={styles.npcConversation}>
          <div className={styles.npcIdentity}>
            <span className={styles.speakerPortrait} aria-hidden="true">
              <UserCircle weight="duotone" />
            </span>
            <strong>{npcName}</strong>
            <small>{npcRole || "NPC"}</small>
          </div>

          <div
            className={styles.conversationBubbles}
            ref={conversationRef}
            role="log"
            aria-label="현재 대화 한 턴"
          >
            <div className={styles.npcSpeechBubble} aria-live="polite">
              <p>
                {displayNpcMessage ||
                  (isStreaming ? "" : `${npcName}에게 궁금한 점을 물어보세요.`)}
                {isStreaming ? <span aria-hidden="true">▍</span> : null}
              </p>
            </div>
            {userMessage ? (
              <div className={styles.userSpeechBubble} aria-label="내 답변" aria-live="polite">
                <p>{userMessage}</p>
              </div>
            ) : null}
          </div>
        </div>

        <form className={styles.dialogueComposer} onSubmit={handleSubmit}>
          {voiceIssue ? (
            <p className={styles.scenarioVoiceIssue} role="alert">
              {voiceIssue}
            </p>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={disabled ? disabledHint : placeholder}
            aria-label="NPC에게 보낼 답변"
            disabled={disabled}
          />
          <button
            className={styles.sendDialogueButton}
            type="submit"
            aria-label="답변 보내기"
            disabled={disabled || !draft.trim()}
          >
            <PaperPlaneTilt weight="fill" aria-hidden="true" />
          </button>
          <button
            className={`${styles.voiceDialogueButton} ${recordingState === "recording" ? styles.voiceDialogueButtonActive : ""}`}
            type="button"
            onClick={handleVoiceInput}
            data-state={recordingState}
            aria-label={recordingState === "recording" ? "음성 입력 종료" : "음성 입력 시작"}
            aria-pressed={recordingState === "recording"}
            disabled={disabled || recordingState === "requesting" || recordingState === "processing"}
            title={voiceIssue ?? undefined}
          >
            {recordingState === "requesting" || recordingState === "processing" ? (
              <CircleNotch className={styles.voiceDialogueSpinner} aria-hidden="true" />
            ) : recordingState === "recording" ? (
              <Stop weight="fill" aria-hidden="true" />
            ) : (
              <Microphone weight="duotone" aria-hidden="true" />
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
