import { useState, type CSSProperties } from "react";
import styles from "../../styles/oneToOneConversation.module.css";
import type { ConversationMessage, RecordingState } from "../../types/conversation";
import { ChatComposer } from "./ChatComposer";
import { ChatExpandToggle } from "./ChatExpandToggle";
import { MessageList } from "./MessageList";
import { VoiceLevelMeter } from "./VoiceLevelMeter";

type ConversationPanelProps = {
  messages: ConversationMessage[];
  inputValue: string;
  recordingState: RecordingState;
  voiceLevel: number;
  expanded: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceInput: () => void;
  onToggleExpanded: () => void;
  onOpenSurvey: () => void;
};

type ConversationPanelStyle = CSSProperties & {
  "--composer-height": string;
};

export function ConversationPanel(props: ConversationPanelProps) {
  const [composerHeight, setComposerHeight] = useState(46);

  return (
    <section
      className={`${styles.conversationPanel} ${props.expanded ? styles.conversationPanelExpanded : ""}`}
      style={{ "--composer-height": `${composerHeight}px` } as ConversationPanelStyle}
      aria-label="AI 직무 마스터와의 1대1 대화"
    >
      <ChatExpandToggle expanded={props.expanded} onToggle={props.onToggleExpanded} />
      <MessageList messages={props.messages} onOpenSurvey={props.onOpenSurvey} />
      <VoiceLevelMeter
        active={props.recordingState === "recording"}
        level={props.voiceLevel}
      />
      <ChatComposer
        inputValue={props.inputValue}
        recordingState={props.recordingState}
        onInputChange={props.onInputChange}
        onSend={props.onSend}
        onVoiceInput={props.onVoiceInput}
        onHeightChange={setComposerHeight}
      />
    </section>
  );
}
