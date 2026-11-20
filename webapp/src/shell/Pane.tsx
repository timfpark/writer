import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import controls from "./controls.module.css";
import styles from "./Pane.module.css";
import type { PaneState } from "./usePane";

interface PaneProps {
  pane: PaneState;
  label: string;
  landmark: "nav" | "aside";
  children: ReactNode;
}

export function paneId(pane: PaneState): string {
  return `${pane.name}-pane`;
}

// A side pane, docked beside the writing region or, below its breakpoint,
// opened over it. An overlaid pane closes on Escape, a tap outside it, or its
// close button, and React Aria returns focus to where it was.
export function Pane({ pane, label, landmark: Landmark, children }: PaneProps) {
  const headingId = `${pane.name}-pane-title`;
  const body = (closeButton: ReactNode) => (
    <Landmark className={styles.landmark} aria-labelledby={headingId}>
      <div className={styles.paneHeader}>
        <h2 id={headingId} className={styles.paneTitle}>
          {label}
        </h2>
        {closeButton}
      </div>
      <div className={styles.content}>{children}</div>
    </Landmark>
  );

  if (pane.docked) {
    // Kept mounted while collapsed, so the pane's state survives.
    return (
      <div
        id={paneId(pane)}
        className={`${styles.docked} ${styles[pane.name]}`}
        hidden={!pane.open}
      >
        {body(null)}
      </div>
    );
  }

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={pane.open}
      onOpenChange={(isOpen) => {
        if (!isOpen) pane.close();
      }}
      isDismissable
    >
      <Modal className={`${styles.drawer} ${styles[pane.name]}`}>
        <Dialog className={styles.dialog} aria-labelledby={headingId}>
          {body(
            <Button
              slot="close"
              className={controls.iconButton}
              aria-label={`Close ${label.toLowerCase()}`}
            >
              <X aria-hidden size={18} />
            </Button>,
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
