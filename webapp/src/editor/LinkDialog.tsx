import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  FieldError,
  Form,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import styles from "./LinkDialog.module.css";

export interface LinkTarget {
  href: string;
  // Whether the caret or selection is on an existing link.
  isLink: boolean;
  // The selection when the dialog opened, which the dialog acts on.
  from: number;
  to: number;
}

const schemes = new Set(["http", "https", "mailto", "tel"]);

// Web, mail, and phone addresses, and relative ones, but never a script.
export function isAllowedHref(href: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1];
  return scheme === undefined || schemes.has(scheme.toLowerCase());
}

interface LinkDialogProps {
  target: LinkTarget;
  // Applies the address, resolving to whether the editor accepted it.
  onApply: (href: string) => boolean;
  onRemove: () => void;
  onClose: () => void;
}

// Creates, edits, or removes the link at the caret, opened by Mod+K.
export function LinkDialog({
  target,
  onApply,
  onRemove,
  onClose,
}: LinkDialogProps) {
  const [href, setHref] = useState(target.href);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = href.trim();
    if (value === "") {
      if (target.isLink) onRemove();
      onClose();
      return;
    }
    if (!isAllowedHref(value) || !onApply(value)) {
      setError("Use a web, mail, or phone address.");
      return;
    }
    onClose();
  }

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
        <Dialog className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {target.isLink ? "Edit link" : "Add link"}
          </Heading>
          <Form onSubmit={submit}>
            <TextField
              className={styles.field}
              value={href}
              onChange={(value) => {
                setHref(value);
                setError(null);
              }}
              isInvalid={error !== null}
            >
              <Label className={styles.label}>Address</Label>
              <Input
                ref={inputRef}
                className={styles.input}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://example.com"
              />
              <FieldError className={styles.error}>{error}</FieldError>
            </TextField>
            <div className={styles.buttons}>
              {target.isLink ? (
                <Button
                  className={`${styles.button} ${styles.remove}`}
                  onPress={() => {
                    onRemove();
                    onClose();
                  }}
                >
                  Remove link
                </Button>
              ) : null}
              <Button slot="close" className={styles.button}>
                Cancel
              </Button>
              <Button
                type="submit"
                className={`${styles.button} ${styles.apply}`}
              >
                {target.isLink ? "Update" : "Add"}
              </Button>
            </div>
          </Form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
