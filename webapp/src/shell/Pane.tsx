import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
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
// opened over it. It shows no heading, so its content starts at the top;
// its label names the landmark for assistive technology. An overlaid pane
// closes on Escape, a tap outside it, or the header's toggle, and React Aria
// returns focus to where it was.
export function Pane({ pane, label, landmark: Landmark, children }: PaneProps) {
  const body = (
    <Landmark className={styles.landmark} aria-label={label}>
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
        {body}
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
        <Dialog className={styles.dialog} aria-label={label}>
          {body}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
