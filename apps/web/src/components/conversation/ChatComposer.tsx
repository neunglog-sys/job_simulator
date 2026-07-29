import { CircleNotch, Microphone, PaperPlaneTilt, Pause } from "@phosphor-icons/react";
import { AnimatePresence } from "motion/react";
import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { RecordingState } from "../../types/conversation";
import { VoiceLevelMeter } from "./VoiceLevelMeter";

type ChatComposerProps = {
  inputValue: string;
  recordingState: RecordingState;
  voiceIssue: string | null;
  voiceLevel: number;
  voiceBands: number[];
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  onHeightChange: (height: number) => void;
};

const MIN_COMPOSER_HEIGHT = 46;
const MAX_COMPOSER_HEIGHT = 142;

export function ChatComposer({
  inputValue,
  recordingState,
  voiceIssue,
  voiceLevel,
  voiceBands,
  onInputChange,
  onSend,
  onVoiceInput,
  onHeightChange,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousHeightRef = useRef(MIN_COMPOSER_HEIGHT);
  const isVoiceBusy = recordingState === "requesting" || recordingState === "processing";
  const isVoiceMode = recordingState !== "idle";
  const isRecording = recordingState === "recording";

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(
      MAX_COMPOSER_HEIGHT,
      Math.max(MIN_COMPOSER_HEIGHT, textarea.scrollHeight),
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";

    if (previousHeightRef.current !== nextHeight) {
      previousHeightRef.current = nextHeight;
      onHeightChange(nextHeight);
    }
  }, [inputValue, onHeightChange]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (inputValue.trim()) onSend();
    }
  };

  return (
    <form className={styles.chatComposer} onSubmit={handleSubmit}>
      {voiceIssue ? (
        <p className={styles.voiceIssue} role="alert">
          {voiceIssue}
        </p>
      ) : null}
      <div className={styles.messageInputWrapper} data-voice-mode={isVoiceMode}>
        <textarea
          ref={textareaRef}
          className={styles.messageInput}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요"
          aria-label="AI 진로 코치에게 보낼 메시지"
          autoComplete="off"
          rows={1}
        />
        <button
          className={styles.sendButton}
          type="submit"
          disabled={!inputValue.trim() || isVoiceMode}
          aria-hidden={isVoiceMode}
          tabIndex={isVoiceMode ? -1 : 0}
          aria-label="메시지 전송"
        >
          <PaperPlaneTilt aria-hidden="true" weight="fill" />
        </button>
        <button
          className={`${styles.voiceButton} ${
            recordingState === "recording" ? styles.voiceRecording : ""
          }`}
          type="button"
          onClick={onVoiceInput}
          disabled={isVoiceBusy}
          data-state={recordingState}
          aria-label={isRecording ? "음성 입력 일시정지" : "음성 입력 시작"}
          aria-pressed={isRecording}
          title={voiceIssue ?? undefined}
        >
          {isVoiceBusy ? (
            <CircleNotch className={styles.voiceSpinner} aria-hidden="true" />
          ) : isRecording ? (
            <Pause aria-hidden="true" weight="fill" />
          ) : (
            <Microphone aria-hidden="true" weight="regular" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {isRecording ? (
            <VoiceLevelMeter level={voiceLevel} bands={voiceBands} />
          ) : null}
        </AnimatePresence>
      </div>
    </form>
  );
}
