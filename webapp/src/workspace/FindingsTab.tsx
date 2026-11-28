import { FileText, MessageSquare, X } from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Button, ToggleButton } from "react-aria-components";
import type { ReadOnlySourceView } from "./conversation";
import {
  FINDING_FILTERS,
  type FindingsStore,
  type TrackedFinding,
} from "./findings";
import styles from "./FindingsTab.module.css";
import { parseReplyInline } from "./reading";

interface FindingsTabProps {
  store: FindingsStore;
  openDocumentId: string | null;
  setupNotice: React.ReactNode;
  onDiscussFinding: (finding: TrackedFinding) => void;
  onOpenSource: (source: ReadOnlySourceView) => void;
  onRevealWriting?: () => void;
}

function renderFormattedNote(note: string) {
  const segments = parseReplyInline(note);
  return segments.map((seg, idx) => {
    if (seg.kind === "italic") {
      return <em key={idx}>{seg.text}</em>;
    }
    if (seg.kind === "quote") {
      return <Fragment key={idx}>{`“${seg.text}”`}</Fragment>;
    }
    return <Fragment key={idx}>{seg.text}</Fragment>;
  });
}

// ADR 0011 and ADR 0012's Findings tab: category filters, reading-order
// finding cards with collapsed `What it read` disclosures, `Passage changed`
// state, `Dismiss`, and `Discuss in Chat` / `Answer in Chat` handoffs.
export function FindingsTab({
  store,
  openDocumentId,
  setupNotice,
  onDiscussFinding,
  onOpenSource,
  onRevealWriting,
}: FindingsTabProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selectedCardRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!snapshot.selectedFindingId) return;
    selectedCardRef.current?.scrollIntoView({
      block: "nearest",
    });
  }, [snapshot.selectedFindingId]);

  const countsByFilter = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("all", snapshot.findings.length);
    for (const f of snapshot.findings) {
      counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    }
    return counts;
  }, [snapshot.findings]);

  const visibleFindings = useMemo(
    () =>
      snapshot.filter === "all"
        ? snapshot.findings
        : snapshot.findings.filter((f) => f.category === snapshot.filter),
    [snapshot.findings, snapshot.filter],
  );

  const focusFindingId = useMemo(() => {
    if (
      snapshot.selectedFindingId &&
      visibleFindings.some((f) => f.findingId === snapshot.selectedFindingId)
    ) {
      return snapshot.selectedFindingId;
    }
    return visibleFindings[0]?.findingId ?? null;
  }, [snapshot.selectedFindingId, visibleFindings]);

  return (
    <div className={styles.panel}>
      {setupNotice}

      {!openDocumentId ? (
        <p className={styles.emptyHint} data-focus-target="" tabIndex={-1}>
          Open a document in the navigator to review its prose for findings.
        </p>
      ) : (
        <>
          <fieldset className={styles.filters}>
            <legend className={styles.srOnly}>Filter findings</legend>
            {FINDING_FILTERS.map((filter) => {
              const count = countsByFilter.get(filter.id) ?? 0;
              const selected = snapshot.filter === filter.id;
              return (
                <ToggleButton
                  key={filter.id}
                  className={styles.filterButton}
                  isSelected={selected}
                  onChange={() => store.setFilter(filter.id)}
                  data-focus-target={
                    focusFindingId === null && filter.id === "all"
                      ? ""
                      : undefined
                  }
                >
                  <span>{filter.label}</span>
                  {count > 0 ? (
                    <span className={styles.filterCount}>{count}</span>
                  ) : null}
                </ToggleButton>
              );
            })}
          </fieldset>

          <div className={styles.listWrap}>
            {visibleFindings.length === 0 ? (
              <p className={styles.emptyHint}>
                {snapshot.findings.length > 0
                  ? "No findings in this category."
                  : snapshot.paused
                    ? "Background review is paused. Resume to check changed passages after you pause typing."
                    : "No findings yet. Pause briefly while writing to check changed passages."}
              </p>
            ) : (
              <ol className={styles.list} aria-label="Findings">
                {visibleFindings.map((finding) => {
                  const isSelected =
                    snapshot.selectedFindingId === finding.findingId;
                  const isFocusTarget = focusFindingId === finding.findingId;
                  const isChanged = finding.status === "changed";
                  const handoffLabel =
                    finding.agent === "openQuestions"
                      ? "Answer in Chat"
                      : "Discuss in Chat";

                  return (
                    <li
                      key={finding.findingId}
                      ref={isSelected ? selectedCardRef : undefined}
                      className={styles.card}
                      data-selected={isSelected ? "true" : undefined}
                      data-status={finding.status}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.agentLabel}>
                          <span
                            className={styles.agentRule}
                            data-style={finding.style}
                            aria-hidden="true"
                          />
                          <span>{finding.agentLabel}</span>
                        </span>
                        {isChanged ? (
                          <span className={styles.changedBadge}>
                            Passage changed
                          </span>
                        ) : null}
                      </div>

                      {isChanged ? (
                        <p className={styles.changedQuote}>
                          {`“${finding.quote}”`}
                        </p>
                      ) : (
                        <Button
                          className={styles.quoteButton}
                          onPress={() => {
                            store.selectFinding(finding.findingId, {
                              moveCaret: false,
                            });
                            onRevealWriting?.();
                          }}
                        >
                          {`“${finding.quote}”`}
                        </Button>
                      )}

                      <p className={styles.note}>
                        {renderFormattedNote(finding.note)}
                      </p>

                      <details className={styles.audit}>
                        <summary className={styles.auditSummary}>
                          What it read
                        </summary>
                        <div className={styles.auditBody}>
                          <ul className={styles.sourceList}>
                            {finding.audit.sources.map((source, idx) => (
                              <li key={idx} className={styles.sourceItem}>
                                <Button
                                  className={styles.sourceLink}
                                  onPress={() => {
                                    onOpenSource(finding.sourceSnapshot);
                                    onRevealWriting?.();
                                  }}
                                >
                                  <FileText aria-hidden size={13} />
                                  <span>{source.label}</span>
                                </Button>
                              </li>
                            ))}
                          </ul>
                          <p className={styles.auditFact}>
                            {`Trigger: ${finding.audit.trigger}`}
                          </p>
                          <p className={styles.auditFact}>
                            {`Why it ran: ${finding.audit.reason}`}
                          </p>
                          <p className={styles.auditFact}>
                            {`Model: ${finding.audit.model}`}
                          </p>
                          {finding.audit.promptVersion ? (
                            <p className={styles.auditFact}>
                              {`Prompt: ${finding.audit.promptVersion}`}
                            </p>
                          ) : null}
                        </div>
                      </details>

                      <div className={styles.actions}>
                        {!isChanged ? (
                          <Button
                            className={styles.actionButton}
                            data-focus-target={isFocusTarget ? "" : undefined}
                            onPress={() => onDiscussFinding(finding)}
                          >
                            <MessageSquare aria-hidden size={13} />
                            <span>{handoffLabel}</span>
                          </Button>
                        ) : null}
                        <Button
                          className={styles.dismissButton}
                          data-focus-target={
                            isChanged && isFocusTarget ? "" : undefined
                          }
                          onPress={() =>
                            store.dismissFinding(finding.findingId)
                          }
                        >
                          <X aria-hidden size={13} />
                          <span>Dismiss</span>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
