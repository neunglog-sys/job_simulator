import { Microphone, PaperPlaneTilt, UserCircle } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import styles from "../../styles/scenarioGame.module.css";

type ScenarioControlPanelProps = {
  onCoachMessage: (message: string) => void;
};

const INITIAL_NPC_MESSAGE =
  "첫 고객 요청이 도착했어요. 고객은 결제 오류가 반복된다고 말하고 있습니다. 상황을 정확히 파악하려면 무엇부터 확인하면 좋을까요?";
const INITIAL_USER_MESSAGE =
  "오류가 발생한 시점과 사용한 결제 수단부터 확인해볼게요.";

export function ScenarioControlPanel({ onCoachMessage }: ScenarioControlPanelProps) {
  const [draft, setDraft] = useState("");
  const [npcMessage, setNpcMessage] = useState(INITIAL_NPC_MESSAGE);
  const [userMessage, setUserMessage] = useState(INITIAL_USER_MESSAGE);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    setUserMessage(message);
    setNpcMessage(
      `좋아요. “${message}”라고 답했군요. 그 판단의 근거를 고객에게 이해하기 쉬운 말로 설명해보세요.`,
    );
    setDraft("");
    onCoachMessage("답변을 전송했어요. 이제 NPC의 다음 질문을 확인해보세요.");
  };

  const toggleVoiceInput = () => {
    setIsVoiceActive((current) => {
      const next = !current;
      onCoachMessage(
        next
          ? "음성 입력을 시작했어요. 답변을 말한 뒤 음성 버튼을 다시 눌러주세요."
          : "음성 입력을 종료했어요.",
      );
      return next;
    });
  };

  return (
    <section className={`${styles.glassPanel} ${styles.dialoguePanel}`} aria-label="NPC 대화창">
      <div className={styles.npcConversation}>
        <div className={styles.npcIdentity}>
          <span className={styles.speakerPortrait} aria-hidden="true">
            <UserCircle weight="duotone" />
          </span>
          <strong>선배 매니저 지오</strong>
          <small>NPC</small>
        </div>

        <div className={styles.conversationBubbles}>
          <div className={styles.npcSpeechBubble} aria-live="polite">
            <p>{npcMessage}</p>
          </div>
          <div className={styles.userSpeechBubble} aria-label="내 답변" aria-live="polite">
            <p>{userMessage}</p>
          </div>
        </div>
      </div>

      <form className={styles.dialogueComposer} onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="NPC에게 보낼 답변을 입력하세요"
          aria-label="NPC에게 보낼 답변"
        />
        <button className={styles.sendDialogueButton} type="submit" aria-label="답변 보내기">
          <PaperPlaneTilt weight="fill" aria-hidden="true" />
        </button>
        <button
          className={`${styles.voiceDialogueButton} ${isVoiceActive ? styles.voiceDialogueButtonActive : ""}`}
          type="button"
          onClick={toggleVoiceInput}
          aria-label={isVoiceActive ? "음성 입력 종료" : "음성 입력 시작"}
          aria-pressed={isVoiceActive}
        >
          <Microphone weight={isVoiceActive ? "fill" : "duotone"} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
