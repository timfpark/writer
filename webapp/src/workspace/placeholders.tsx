import styles from "./placeholders.module.css";

// Stand-ins until backlog 22 builds the navigator and backlog 25 the
// assistant.
export function NavigatorPlaceholder() {
  return (
    <p className={styles.placeholder}>
      Your folders and documents will appear here.
    </p>
  );
}

export function AssistantPlaceholder() {
  return (
    <p className={styles.placeholder}>Your pair writer will join you here.</p>
  );
}
