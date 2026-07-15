import { CircleNotch, Microphone, PaperPlaneTilt, Stop } from "@phosphor-icons/react";
import type { FormEvent } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { RecordingState } from "../../types/conversation";

type ChatComposerProps = {
  inputValue: string;
  recordingState: RecordingState;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
};

export function ChatComposer({
  inputValue,
  recordingState,
  onInputChange,
  onSend,
  onVoiceInput,
}: ChatComposerProps) {
  const isVoiceBusy = recordingState === "requesting" || recordingState === "processing";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSend();
  };

  return (
    <form className={styles.chatComposer} onSubmit={handleSubmit}>
      <div className={styles.messageInputWrapper}>
        <input
          className={styles.messageInput}
          type="text"
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="메시지를 입력하세요"
          aria-label="AI 직무 마스터에게 보낼 메시지"
          autoComplete="off"
        />
        <button
          className={styles.sendButton}
          type="submit"
          disabled={!inputValue.trim()}
          aria-label="메시지 전송"
        >
          <PaperPlaneTilt aria-hidden="true" weight="fill" />
        </button>
      </div>

      <button
        className={`${styles.voiceButton} ${recordingState === "recording" ? styles.voiceRecording : ""}`}
        type="button"
        onClick={onVoiceInput}
        disabled={isVoiceBusy}
        aria-label={recordingState === "recording" ? "음성 입력 중지" : "음성 입력 시작"}
        aria-pressed={recordingState === "recording"}
      >
        {isVoiceBusy ? (
          <CircleNotch className={styles.voiceSpinner} aria-hidden="true" />
        ) : recordingState === "recording" ? (
          <Stop aria-hidden="true" weight="fill" />
        ) : (
          <Microphone aria-hidden="true" weight="regular" />
        )}
      </button>
    </form>
  );
}
