import {
  ChatTeardropText,
  ListChecks,
  Microphone,
  NotePencil,
  PaperPlaneTilt,
  UserCircle,
} from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import styles from "../../styles/scenarioGame.module.css";

type ScenarioControlPanelProps = {
  npcName: string;
  npcRole?: string;
  npcMessage: string;
  userMessage: string;
  isStreaming?: boolean;
  isHistoryOpen?: boolean;
  disabled?: boolean;
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
  disabled = false,
  placeholder = "NPC에게 보낼 답변을 입력하세요",
  disabledHint = "게임 서버에 연결 중이에요…",
  onSend,
  onHistoryToggle,
  onMemoOpen,
  onWorkflowOpen,
}: ScenarioControlPanelProps) {
  const [draft, setDraft] = useState("");
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  // 스트리밍 중 백엔드 정리 전에 잠깐 새어나올 수 있는 화자 태그("[이름] ")를 표시 단계에서도 제거.
  const displayNpcMessage = npcMessage.replace(/^\s*\[[^\]]{1,20}\]\s*/, "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || disabled) return;

    onSend(message);
    setDraft("");
  };

  return (
    <div className={styles.dialogueHudGroup}>
      <div className={styles.dialogueUtilityBar} aria-label="대화 보조 기능">
        <button
          className={`${styles.dialogueUtilityButton} ${isHistoryOpen ? styles.historyDialogueButtonActive : ""}`}
          type="button"
          onClick={onHistoryToggle}
          aria-label={isHistoryOpen ? "이전 대화 닫기" : "이전 대화 보기"}
          aria-expanded={isHistoryOpen}
        >
          <ChatTeardropText weight={isHistoryOpen ? "fill" : "duotone"} aria-hidden="true" />
          <span>이전 대화 보기</span>
        </button>
        <button className={styles.dialogueUtilityButton} type="button" onClick={onMemoOpen}>
          <NotePencil weight="duotone" aria-hidden="true" />
          <span>메모하기</span>
        </button>
        <button className={styles.dialogueUtilityButton} type="button" onClick={onWorkflowOpen}>
          <ListChecks weight="duotone" aria-hidden="true" />
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

          <div className={styles.conversationBubbles}>
            {userMessage ? (
              <div className={styles.userSpeechBubble} aria-label="내 답변" aria-live="polite">
                <p>{userMessage}</p>
              </div>
            ) : null}
            <div className={styles.npcSpeechBubble} aria-live="polite">
              <p>
                {displayNpcMessage ||
                  (isStreaming ? "" : `${npcName}에게 궁금한 점을 물어보세요.`)}
                {isStreaming ? <span aria-hidden="true">▍</span> : null}
              </p>
            </div>
          </div>
        </div>

        <form className={styles.dialogueComposer} onSubmit={handleSubmit}>
          <input
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
            className={`${styles.voiceDialogueButton} ${isVoiceActive ? styles.voiceDialogueButtonActive : ""}`}
            type="button"
            onClick={() => setIsVoiceActive((current) => !current)}
            aria-label={isVoiceActive ? "음성 입력 종료" : "음성 입력 시작"}
            aria-pressed={isVoiceActive}
            disabled={disabled}
          >
            <Microphone weight={isVoiceActive ? "fill" : "duotone"} aria-hidden="true" />
          </button>
        </form>
      </section>
    </div>
  );
}
