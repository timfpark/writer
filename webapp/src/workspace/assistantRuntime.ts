import { AssistantPane } from "./AssistantPane";
import {
  ConversationStore,
  serviceAssistant,
  type Assistant,
} from "./conversation";
import type { EditorBridge } from "./editorBridge";
import { FindingsStore } from "./findings";

export interface AssistantRuntime {
  conversation: ConversationStore;
  findings: FindingsStore;
}

export function createAssistantRuntime(
  bridge: EditorBridge,
  assistant: Assistant = serviceAssistant,
): AssistantRuntime {
  const conversation = new ConversationStore(assistant, bridge);
  const findings = new FindingsStore(assistant, bridge, {
    onUnavailable: () => void conversation.checkReadiness(),
  });
  return { conversation, findings };
}

export { AssistantPane };
