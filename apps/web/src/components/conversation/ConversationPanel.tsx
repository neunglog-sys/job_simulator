import { useState, type CSSProperties } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage, RecordingState } from "../../types/conversation";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";

type ConversationPanelProps = {
  messages: ConversationMessage[];
  inputValue: string;
  recordingState: RecordingState;
  voiceIssue: string | null;
  voiceLevel: number;
  voiceBands: number[];
  variant: "large" | "compact";
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  onOpenSurvey: () => void;
};

type ConversationPanelStyle = CSSProperties & {
  "--composer-height": string;
};

export function ConversationPanel(props: ConversationPanelProps) {
  const [composerHeight, setComposerHeight] = useState(46);

  return (
    <section
      className={styles.conversationPanel}
      data-layout={props.variant}
      style={{ "--composer-height": `${composerHeight}px` } as ConversationPanelStyle}
      aria-label="AI 직무 마스터와의 1대1 대화"
    >
      <MessageList messages={props.messages} onOpenSurvey={props.onOpenSurvey} />
      <ChatComposer
        inputValue={props.inputValue}
        recordingState={props.recordingState}
        voiceIssue={props.voiceIssue}
        voiceLevel={props.voiceLevel}
        voiceBands={props.voiceBands}
        onInputChange={props.onInputChange}
        onSend={props.onSend}
        onVoiceInput={props.onVoiceInput}
        onHeightChange={setComposerHeight}
      />
    </section>
  );
}
