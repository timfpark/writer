import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import type { ItemKind } from "../api/client";
import styles from "./DeleteDialog.module.css";

interface DeleteDialogProps {
  kind: ItemKind;
  title: string;
  // How many items below the item the deletion also removes.
  descendants: number;
  onConfirm: () => void;
  onClose: () => void;
}

function deletionSummary(kind: ItemKind, descendants: number): string {
  if (kind === "document") return "This permanently deletes the document.";
  if (descendants === 0) return "This permanently deletes the empty folder.";
  const items = descendants === 1 ? "1 item" : `${descendants} items`;
  return `This permanently deletes the folder and the ${items} inside it.`;
}

// Deletion is permanent, as ADR 0005 decides, so the navigator asks first and
// says how much a folder deletion removes.
export function DeleteDialog({
  kind,
  title,
  descendants,
  onConfirm,
  onClose,
}: DeleteDialogProps) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Modal className={styles.modal}>
        <Dialog role="alertdialog" className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {`Delete “${title}”?`}
          </Heading>
          <p className={styles.body}>
            {`${deletionSummary(kind, descendants)} It can't be undone.`}
          </p>
          <div className={styles.buttons}>
            <Button slot="close" className={styles.button}>
              Cancel
            </Button>
            <Button
              className={`${styles.button} ${styles.confirm}`}
              onPress={() => {
                onConfirm();
                onClose();
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
