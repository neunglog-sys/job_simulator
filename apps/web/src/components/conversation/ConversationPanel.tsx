import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage, RecordingState } from "../../types/conversation";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";

type ConversationPanelProps = {
  messages: ConversationMessage[];
  inputValue: string;
  recordingState: RecordingState;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
};

export function ConversationPanel(props: ConversationPanelProps) {
  return (
    <section className={styles.conversationPanel} aria-label="AI 직무 마스터와의 1대1 대화">
      <MessageList messages={props.messages} />
      <ChatComposer
        inputValue={props.inputValue}
        recordingState={props.recordingState}
        onInputChange={props.onInputChange}
        onSend={props.onSend}
        onVoiceInput={props.onVoiceInput}
      />
    </section>
  );
}
