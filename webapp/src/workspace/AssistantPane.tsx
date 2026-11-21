import { ArrowUp } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button, Form, TextArea, TextField } from "react-aria-components";
import controls from "../shell/controls.module.css";
import styles from "./AssistantPane.module.css";
import type { Conversation } from "./conversation";

// The conversation with the pair writer: a transcript that keeps the newest
// message in view above a message box. Enter sends and Shift+Enter starts a
// new line.
export function AssistantPane({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { messages, draft, setDraft, send } = conversation;
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || messages.length === 0) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An input method may use Enter to confirm composed text.
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  return (
    <div className={styles.assistant}>
      {messages.length === 0 ? (
        <p className={styles.empty}>
          Talk with your pair writer here. It isn't connected yet.
        </p>
      ) : null}
      <div
        ref={transcriptRef}
        className={styles.transcript}
        role="log"
        aria-label="Conversation"
      >
        <ol className={styles.messages}>
          {messages.map((message) => (
            <li
              key={message.id}
              className={styles.message}
              data-role={message.role}
            >
              <span className={styles.speaker}>
                {message.role === "writer" ? "You" : "Assistant"}
              </span>
              <p className={styles.text}>{message.text}</p>
            </li>
          ))}
        </ol>
      </div>
      <Form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <TextField
          className={styles.field}
          aria-label="Message the assistant"
          value={draft}
          onChange={setDraft}
        >
          <TextArea
            className={styles.input}
            rows={3}
            placeholder="Message the assistant"
            onKeyDown={onKeyDown}
          />
        </TextField>
        <Button
          type="submit"
          className={`${controls.iconButton} ${styles.send}`}
          aria-label="Send"
          isDisabled={!draft.trim()}
        >
          <ArrowUp aria-hidden size={18} />
        </Button>
      </Form>
    </div>
  );
}
