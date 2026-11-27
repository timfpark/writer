import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "react-aria-components";
import type { ReadOnlySourceView as SourceViewData } from "./conversation";
import styles from "./ReadOnlySourceView.module.css";
import { WritingPage } from "./WritingPage";

interface ReadOnlySourceViewProps {
  source: SourceViewData;
  onClose: () => void;
}

// Reopens a document source from `What it read` or `View text then` read-only
// in the writing region, exactly as the pair writer read it. Pressing
// `Back to current draft` or `Escape` returns to the live draft.
export function ReadOnlySourceView({
  source,
  onClose,
}: ReadOnlySourceViewProps) {
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Do not intercept Escape when a modal dialog or popover is open.
      if (
        document.activeElement?.closest("[role='dialog'], [role='alertdialog']")
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const blocks = source.markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.length > 0);

  return (
    <section
      className={styles.container}
      aria-label={`Read-only snapshot of ${source.title}`}
    >
      <div className={styles.banner}>
        <div className={styles.meta}>
          <span className={styles.badge}>Read-only</span>
          <span className={styles.heading}>
            {`${source.title} · ${source.subtitle}`}
          </span>
        </div>
        <Button ref={backButtonRef} className={styles.back} onPress={onClose}>
          <ArrowLeft aria-hidden size={14} />
          <span>Back to current draft</span>
        </Button>
      </div>
      <WritingPage>
        <div className={styles.prose} data-readonly-source="">
          {blocks.length === 0 ? (
            <p className={styles.empty}>(Empty document when read.)</p>
          ) : (
            blocks.map((block, index) => (
              <p key={index} className={styles.block}>
                {block}
              </p>
            ))
          )}
        </div>
      </WritingPage>
    </section>
  );
}
