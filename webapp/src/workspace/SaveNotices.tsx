import { X } from "lucide-react";
import { Button } from "react-aria-components";
import { useSaveNotices } from "../saving/saveManager";
import controls from "../shell/controls.module.css";
import styles from "./SaveNotices.module.css";

// Notices about recovered text, such as a conflict copy, which stay until
// the writer dismisses them, as ADR 0005 requires.
export function SaveNotices() {
  const { notices, dismiss } = useSaveNotices();
  return (
    <div className={styles.notices} aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={styles.notice}>
          <span className={styles.text}>{notice.message}</span>
          <Button
            className={controls.iconButton}
            aria-label="Dismiss"
            onPress={() => dismiss(notice.id)}
          >
            <X aria-hidden size={16} />
          </Button>
        </div>
      ))}
    </div>
  );
}
