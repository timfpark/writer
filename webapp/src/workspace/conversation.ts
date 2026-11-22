import { createContext, useCallback, useContext, useState } from "react";

export interface Message {
  id: string;
  role: "writer" | "assistant";
  text: string;
}

// What answers the writer in the assistant pane. Backlog 12's pair-writing
// agent replaces the stub with calls to the service behind this interface.
export interface Assistant {
  reply(conversation: readonly Message[]): Promise<string>;
}

export const notConnectedReply =
  "I'm not connected yet. Your pair writer will answer here once it joins.";

// Answers in the browser without any request, so nothing leaves the page.
export const stubAssistant: Assistant = {
  reply: () => Promise.resolve(notConnectedReply),
};

export const AssistantContext = createContext<Assistant>(stubAssistant);

export interface Conversation {
  messages: readonly Message[];
  draft: string;
  setDraft: (draft: string) => void;
  send: () => void;
}

// The conversation lives in memory only: it is never sent to the service or
// saved, and a reload clears it. The shell owns it, so it outlives the pane,
// which unmounts while it is closed over the writing region.
export function useConversation(): Conversation {
  const assistant = useContext(AssistantContext);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [draft, setDraft] = useState("");

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const sent: Message = { id: crypto.randomUUID(), role: "writer", text };
    const conversation = [...messages, sent];
    setMessages(conversation);
    setDraft("");
    const answer = (reply: string) => {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: reply },
      ]);
    };
    assistant
      .reply(conversation)
      .then(answer, () => answer("I couldn't answer that. Try again."));
  }, [assistant, draft, messages]);

  return { messages, draft, setDraft, send };
}
