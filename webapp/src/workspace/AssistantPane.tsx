import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUp,
  FileText,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Form,
  Popover,
  TextArea,
  TextField,
} from "react-aria-components";
import { client, type PairWriterStatus } from "../api/client";
import { read } from "../api/queries";
import { useWorkspaceTree } from "../api/workspaceChanges";
import controls from "../shell/controls.module.css";
import { regionElement } from "../shell/regions";
import styles from "./AssistantPane.module.css";
import {
  latestWriterTurn,
  READING_LIMIT_WORDS,
  selectionKey,
  STARTER_PROMPTS,
  type AssistantMessage,
  type ChatThread,
  type ConversationStore,
  type TurnAudit,
} from "./conversation";
import { useEditorBridge, useEditorSummary } from "./editorBridge";
import {
  countWords,
  formatWords,
  parseReplyInline,
  scopeLabel,
} from "./reading";

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

function setupHeading(status: PairWriterStatus): string {
  switch (status.issue) {
    case "notConfigured":
      return "Pair writer is not configured";
    case "modelMissing":
      return status.model
        ? `Model “${status.model}” is not available`
        : "Pair-writer model is missing";
    case "runtimeUnreachable":
      return status.provider === "ollama"
        ? "Ollama is not reachable"
        : "Pair writer is unreachable";
    default:
      return "Pair writer is not ready";
  }
}

// ADR 0012's Chat tab: threads belonging to documents, reading summary above
// the composer, mirrored selection chip, `+ Context`, streaming with `Stop`
// from the moment of sending, verbatim quote links, `What it read` disclosures,
// edited-document revival, and setup/error/no-document states.
export function AssistantPane({
  store,
  onRevealWriting,
}: {
  store: ConversationStore;
  onRevealWriting?: () => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const bridge = useEditorBridge();
  const editorSummary = useEditorSummary();
  const { items } = useWorkspaceTree();
  const { documentId } = useParams({ strict: false });
  const navigate = useNavigate();

  const openDocumentId = documentId ?? null;
  const workspaceDocs = useMemo(
    () => (items ?? []).filter((item) => item.kind === "document"),
    [items],
  );
  const docsById = useMemo(
    () => new Map(workspaceDocs.map((doc) => [doc.id, doc])),
    [workspaceDocs],
  );
  const openDoc = openDocumentId
    ? (docsById.get(openDocumentId) ?? null)
    : null;

  const activeThread = useMemo(
    () =>
      snapshot.activeThreadId
        ? (snapshot.threads.find((t) => t.id === snapshot.activeThreadId) ??
          null)
        : null,
    [snapshot.threads, snapshot.activeThreadId],
  );
  const streamingThread = useMemo(
    () =>
      snapshot.streamingThreadId
        ? (snapshot.threads.find((t) => t.id === snapshot.streamingThreadId) ??
          null)
        : null,
    [snapshot.threads, snapshot.streamingThreadId],
  );

  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(
    null,
  );
  const confirmingHeaderDelete =
    activeThread !== null &&
    confirmingDeleteKey === `header:${activeThread.id}`;
  const [contextOpen, setContextOpen] = useState(false);
  const [contextNote, setContextNote] = useState<string | null>(null);
  const [loadingContextId, setLoadingContextId] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const newChatButtonRef = useRef<HTMLButtonElement>(null);
  const listViewRef = useRef<HTMLDivElement>(null);
  // Set only by explicit navigation clicks inside the pane so switching
  // documents in the navigator never steals focus from the editor.
  const pendingFocusViewRef = useRef<"list" | "thread" | null>(null);

  // If F6 landed on the assistant landmark before this lazy chunk mounted,
  // move focus straight to the active view's focus target.
  useEffect(() => {
    if (document.activeElement !== regionElement("assistant")) return;
    const target = regionElement("assistant")?.querySelector<HTMLElement>(
      "[data-focus-target]",
    );
    target?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const requested = pendingFocusViewRef.current;
    if (!requested || requested !== snapshot.view) return;
    pendingFocusViewRef.current = null;
    if (snapshot.view === "list") {
      if (newChatButtonRef.current && !newChatButtonRef.current.disabled) {
        newChatButtonRef.current.focus({ preventScroll: true });
      } else {
        listViewRef.current?.focus({ preventScroll: true });
      }
    } else if (
      inputRef.current &&
      openDocumentId !== null &&
      !(activeThread !== null && activeThread.documentId !== openDocumentId)
    ) {
      inputRef.current.focus({ preventScroll: true });
    } else {
      backButtonRef.current?.focus({ preventScroll: true });
    }
  }, [snapshot.view, activeThread, openDocumentId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !activeThread || activeThread.messages.length === 0) {
      return;
    }
    transcript.scrollTop = transcript.scrollHeight;
  }, [activeThread]);

  // Grow the message box with its text up to its maximum height, then scroll.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.blockSize = "";
    if (snapshot.draft) input.style.blockSize = `${input.scrollHeight}px`;
  }, [snapshot.draft]);

  const activeSelection = useMemo(() => {
    if (!openDocumentId || editorSummary?.documentId !== openDocumentId) {
      return null;
    }
    const sel = editorSummary.selection;
    const key = selectionKey(sel);
    if (!sel || !key || key === snapshot.ignoredSelectionKey) return null;
    return { ...sel, key };
  }, [openDocumentId, editorSummary, snapshot.ignoredSelectionKey]);

  // Reading plan preview shown above the composer before sending.
  const openDocWordCount =
    openDocumentId && editorSummary?.documentId === openDocumentId
      ? editorSummary.wordCount
      : 0;
  const openDocScope =
    openDocWordCount > READING_LIMIT_WORDS
      ? activeSelection
        ? "aroundSelection"
        : "aroundCursor"
      : "whole";
  const openDocReadWords = Math.min(openDocWordCount, READING_LIMIT_WORDS);
  const extraContextWords = snapshot.extraContext.reduce(
    (sum, doc) => sum + doc.wordCount,
    0,
  );
  const readingTotalWords = openDocReadWords + extraContextWords;
  const remainingContextWords = Math.max(
    0,
    READING_LIMIT_WORDS - readingTotalWords,
  );

  // Detect whether the open document changed since the active thread's latest
  // turn (checked lazily when editorSummary.version bumps after debounced edits).
  const lastWriter = useMemo(
    () => latestWriterTurn(activeThread),
    [activeThread],
  );
  const isPendingHere =
    snapshot.pendingSend !== null &&
    snapshot.pendingSend.documentId === openDocumentId &&
    snapshot.pendingSend.threadId === (activeThread?.id ?? null);
  const isStreamingAny =
    snapshot.streamingThreadId !== null || snapshot.pendingSend !== null;
  const isStreamingHere =
    (activeThread !== null && snapshot.streamingThreadId === activeThread.id) ||
    isPendingHere;

  const documentEditedSinceChat = useMemo(() => {
    if (
      !activeThread ||
      !openDocumentId ||
      activeThread.documentId !== openDocumentId ||
      !lastWriter ||
      isStreamingHere ||
      !editorSummary ||
      editorSummary.documentId !== openDocumentId
    ) {
      return false;
    }
    return editorSummary.version !== lastWriter.openDocVersion;
  }, [
    activeThread,
    openDocumentId,
    lastWriter,
    isStreamingHere,
    editorSummary,
  ]);

  const isOtherDocThread =
    activeThread !== null && activeThread.documentId !== openDocumentId;
  const otherDocExists =
    activeThread !== null && docsById.has(activeThread.documentId);
  const isReady = snapshot.readiness.status?.ready === true;
  const showSetupNotice =
    snapshot.readiness.checked &&
    snapshot.readiness.status !== null &&
    !snapshot.readiness.status.ready;

  // When a setup notice is visible, recheck readiness whenever the window
  // regains focus or becomes visible so starting Ollama or pulling the model
  // clears the notice without reloading the page.
  useEffect(() => {
    if (!showSetupNotice) return undefined;
    function recheck() {
      if (document.visibilityState === "hidden") return;
      if (store.getSnapshot().readiness.checking) return;
      void store.checkReadiness();
    }
    globalThis.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      globalThis.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [showSetupNotice, store]);

  const canSendInCurrentContext =
    openDocumentId !== null && !isOtherDocThread && !isStreamingAny;
  const sendDisabled =
    !canSendInCurrentContext || !isReady || !snapshot.draft.trim();

  const thisDocThreads = useMemo(
    () =>
      openDocumentId
        ? snapshot.threads.filter((t) => t.documentId === openDocumentId)
        : [],
    [snapshot.threads, openDocumentId],
  );
  const otherStreaming =
    (snapshot.streamingThreadId !== null &&
      snapshot.streamingThreadId !== activeThread?.id) ||
    (snapshot.pendingSend !== null && !isPendingHere);
  const otherUnread = snapshot.threads.some(
    (t) => t.id !== activeThread?.id && t.unread,
  );
  const otherActivitySignal = otherStreaming
    ? "streaming"
    : otherUnread
      ? "unread"
      : null;

  function handleShowThreadList() {
    setConfirmingDeleteKey(null);
    pendingFocusViewRef.current = "list";
    store.showThreadList();
  }

  function handleSelectThread(threadId: string) {
    setConfirmingDeleteKey(null);
    pendingFocusViewRef.current = "thread";
    store.selectThread(threadId);
  }

  function handleStartNewThread() {
    setConfirmingDeleteKey(null);
    pendingFocusViewRef.current = "thread";
    store.startNewThread();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!sendDisabled) void store.send();
  }

  async function toggleContextDocument(docId: string, title: string) {
    setContextNote(null);
    if (snapshot.extraContext.some((c) => c.documentId === docId)) {
      store.removeContextDocument(docId);
      return;
    }
    setLoadingContextId(docId);
    try {
      const content = await read(
        client.GET("/api/v1/documents/{documentId}/content", {
          params: { path: { documentId: docId } },
        }),
      );
      const words = countWords(content.markdown);
      if (readingTotalWords + words > READING_LIMIT_WORDS) {
        setContextNote(
          `“${title}” (${formatWords(words)}) would exceed the ${formatWords(READING_LIMIT_WORDS)} limit.`,
        );
        return;
      }
      store.addContextDocument({
        documentId: docId,
        title,
        markdown: content.markdown,
        wordCount: words,
      });
      setContextOpen(false);
    } catch {
      setContextNote(`Could not read “${title}”.`);
    } finally {
      setLoadingContextId(null);
    }
  }

  function openThreadDocument(thread: ChatThread) {
    const targetId = store.prepareOpenDocumentForThread(thread.id);
    if (!targetId) return;
    void navigate({
      to: "/documents/$documentId",
      params: { documentId: targetId },
    });
  }

  function viewTextThen() {
    if (!activeThread || !lastWriter) return;
    store.openSource({
      documentId: activeThread.documentId,
      title: activeThread.documentTitle,
      subtitle: `${scopeLabel(lastWriter.openDocScope)} · ${formatWords(lastWriter.openDocWordCount)} · as read`,
      markdown: lastWriter.openDocReadMarkdown,
    });
    onRevealWriting?.();
  }

  function openAuditSource(audit: TurnAudit, documentIdToOpen: string) {
    const snap = audit.snapshots.find((s) => s.documentId === documentIdToOpen);
    if (!snap) return;
    store.openSource({
      documentId: snap.documentId,
      title: snap.title,
      subtitle: `${snap.subtitle} · as read`,
      markdown: snap.markdown,
    });
    onRevealWriting?.();
  }

  function renderReplyText(message: AssistantMessage) {
    if (message.streaming && !message.text) {
      return (
        <p className={styles.readingStatus}>
          {`Reading ${formatWords(message.readingWords)}…`}
        </p>
      );
    }
    if (!message.text && message.stopped) {
      return (
        <p className={styles.stoppedNote}>Stopped before the reply started.</p>
      );
    }
    const canLinkQuotes =
      openDocumentId !== null && activeThread?.documentId === openDocumentId;
    // Depend on editorSummary?.version via render so quote links downgrade to
    // plain text once a passage is edited.
    void editorSummary?.version;

    const lines = message.text.split("\n");
    return (
      <div className={styles.replyBody}>
        {lines.map((line, lineIndex) => {
          if (!line.trim()) return null;
          const segments = parseReplyInline(line);
          return (
            <p key={lineIndex} className={styles.replyParagraph}>
              {segments.map((segment, segIndex) => {
                if (segment.kind === "italic") {
                  return <em key={segIndex}>{segment.text}</em>;
                }
                if (segment.kind === "quote") {
                  const matches =
                    canLinkQuotes &&
                    openDocumentId !== null &&
                    bridge.hasExactQuote(openDocumentId, segment.text);
                  if (matches && openDocumentId !== null) {
                    return (
                      <Button
                        key={segIndex}
                        className={styles.quoteLink}
                        onPress={() => {
                          bridge.highlightQuote(openDocumentId, segment.text);
                          onRevealWriting?.();
                        }}
                      >
                        {`“${segment.text}”`}
                      </Button>
                    );
                  }
                  return (
                    <Fragment key={segIndex}>{`“${segment.text}”`}</Fragment>
                  );
                }
                return <Fragment key={segIndex}>{segment.text}</Fragment>;
              })}
            </p>
          );
        })}
      </div>
    );
  }

  const otherContextCandidates = workspaceDocs.filter(
    (doc) => doc.id !== openDocumentId,
  );

  const setupNotice =
    showSetupNotice && snapshot.readiness.status ? (
      <output className={styles.notice}>
        <div className={styles.noticeBody}>
          <p className={styles.noticeTitle}>
            {setupHeading(snapshot.readiness.status)}
          </p>
          <p className={styles.noticeText}>
            {snapshot.readiness.status.detail ??
              "Configure a pair-writer provider in the service."}{" "}
            See <code>service/README.md</code> for setup steps.
          </p>
        </div>
        <Button
          className={styles.smallButton}
          isDisabled={snapshot.readiness.checking}
          onPress={() => void store.checkReadiness()}
        >
          Check again
        </Button>
      </output>
    ) : null;

  function renderThreadRow(
    thread: ChatThread,
    section: "doc" | "all",
    meta: string,
  ) {
    const confirmKey = `${section}:${thread.id}`;
    const confirmingRowDelete = confirmingDeleteKey === confirmKey;
    const isThreadStreaming = snapshot.streamingThreadId === thread.id;
    const signal = isThreadStreaming
      ? "streaming"
      : thread.unread
        ? "unread"
        : null;

    if (confirmingRowDelete) {
      return (
        <li key={thread.id} className={styles.rowConfirm}>
          <span className={styles.confirmText}>
            {`Delete “${truncate(thread.title, 32)}”?`}
          </span>
          <div className={styles.confirmButtons}>
            <Button
              className={styles.smallButton}
              onPress={() => setConfirmingDeleteKey(null)}
            >
              Cancel
            </Button>
            <Button
              className={`${styles.smallButton} ${styles.confirmDelete}`}
              onPress={() => {
                store.deleteThread(thread.id);
                setConfirmingDeleteKey(null);
              }}
            >
              Confirm delete
            </Button>
          </div>
        </li>
      );
    }

    return (
      <li key={thread.id} className={styles.threadRow}>
        <Button
          className={styles.threadItem}
          data-current={thread.id === activeThread?.id ? "true" : undefined}
          onPress={() => handleSelectThread(thread.id)}
        >
          <span className={styles.threadItemBody}>
            <span className={styles.threadItemTitle}>{thread.title}</span>
            <span className={styles.threadItemMeta}>{meta}</span>
          </span>
          {signal ? (
            <>
              <span className={styles.srOnly}>
                {signal === "streaming" ? " (replying)" : " (unread reply)"}
              </span>
              <span
                className={styles.dot}
                data-signal={signal}
                aria-hidden="true"
              />
            </>
          ) : null}
        </Button>
        <Button
          className={styles.rowDeleteButton}
          aria-label={`Delete ${thread.title}`}
          onPress={() => setConfirmingDeleteKey(confirmKey)}
        >
          <Trash2 aria-hidden size={14} />
        </Button>
      </li>
    );
  }

  if (snapshot.view === "list") {
    return (
      <div ref={listViewRef} className={styles.assistant} tabIndex={-1}>
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <h2 className={styles.listHeading}>Chats</h2>
            <Button
              ref={newChatButtonRef}
              className={styles.newChatButton}
              onPress={handleStartNewThread}
              isDisabled={!openDocumentId}
              data-focus-target={openDocumentId ? "" : undefined}
            >
              <Plus aria-hidden size={14} />
              <span>New chat</span>
            </Button>
          </div>
        </div>

        {setupNotice}

        <div className={styles.listBody}>
          {openDocumentId ? (
            <section className={styles.threadSection}>
              <h3 className={styles.sectionHeading}>This document</h3>
              {thisDocThreads.length === 0 ? (
                <p className={styles.emptySection}>
                  No chats for this document yet.
                </p>
              ) : (
                <ul className={styles.threadList}>
                  {thisDocThreads.map((thread) => {
                    const turns = thread.messages.filter(
                      (m) => m.role === "writer",
                    ).length;
                    const meta =
                      snapshot.streamingThreadId === thread.id
                        ? "Replying…"
                        : turns === 1
                          ? "1 message"
                          : `${turns} messages`;
                    return renderThreadRow(thread, "doc", meta);
                  })}
                </ul>
              )}
            </section>
          ) : null}

          <section className={styles.threadSection}>
            <h3 className={styles.sectionHeading}>All chats</h3>
            {snapshot.threads.length === 0 ? (
              <p className={styles.emptySection}>No chats yet.</p>
            ) : (
              <ul className={styles.threadList}>
                {snapshot.threads.map((thread) => {
                  const deleted = !docsById.has(thread.documentId);
                  const meta = deleted
                    ? `${thread.documentTitle} · Deleted document`
                    : thread.documentTitle;
                  return renderThreadRow(thread, "all", meta);
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.assistant}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <Button
            ref={backButtonRef}
            className={styles.backButton}
            onPress={handleShowThreadList}
          >
            <ArrowLeft aria-hidden size={14} />
            <span>Chats</span>
            {otherActivitySignal ? (
              <>
                <span className={styles.srOnly}>
                  {otherActivitySignal === "streaming"
                    ? " (replying in another chat)"
                    : " (unread reply in another chat)"}
                </span>
                <span
                  className={styles.dot}
                  data-signal={otherActivitySignal}
                  aria-hidden="true"
                />
              </>
            ) : null}
          </Button>

          <div className={styles.headerActions}>
            <Button
              className={styles.headerButton}
              onPress={handleStartNewThread}
              isDisabled={!openDocumentId}
            >
              <Plus aria-hidden size={14} />
              <span>New</span>
            </Button>
            {activeThread && !confirmingHeaderDelete ? (
              <Button
                className={styles.headerButton}
                aria-label="Delete chat"
                onPress={() =>
                  setConfirmingDeleteKey(`header:${activeThread.id}`)
                }
              >
                <Trash2 aria-hidden size={14} />
                <span>Delete</span>
              </Button>
            ) : null}
          </div>
        </div>
        <h2 className={styles.threadHeading}>
          {activeThread ? activeThread.title : "New chat"}
        </h2>
      </div>

      {activeThread && confirmingHeaderDelete ? (
        <section
          className={styles.inlineConfirm}
          aria-label="Confirm delete chat"
        >
          <span className={styles.confirmText}>
            Delete this chat and what it recorded?
          </span>
          <div className={styles.confirmButtons}>
            <Button
              className={styles.smallButton}
              onPress={() => setConfirmingDeleteKey(null)}
            >
              Cancel
            </Button>
            <Button
              className={`${styles.smallButton} ${styles.confirmDelete}`}
              onPress={() => {
                store.deleteThread(activeThread.id);
                setConfirmingDeleteKey(null);
              }}
            >
              Confirm delete
            </Button>
          </div>
        </section>
      ) : null}

      {setupNotice}

      {isOtherDocThread && activeThread ? (
        <div className={styles.banner}>
          <p className={styles.bannerText}>
            {otherDocExists
              ? `This chat belongs to “${activeThread.documentTitle}”.`
              : `This chat belongs to “${activeThread.documentTitle}” (deleted document).`}
          </p>
          {otherDocExists ? (
            <Button
              className={styles.smallButton}
              onPress={() => openThreadDocument(activeThread)}
            >
              Open document
            </Button>
          ) : null}
        </div>
      ) : null}

      {documentEditedSinceChat ? (
        <div className={styles.banner}>
          <p className={styles.bannerText}>Document edited since this chat</p>
          <Button className={styles.smallButton} onPress={viewTextThen}>
            View text then
          </Button>
        </div>
      ) : null}

      <div
        ref={transcriptRef}
        className={styles.transcript}
        role="log"
        aria-label="Conversation"
      >
        {!activeThread ? (
          openDocumentId ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyHint}>
                Ask your pair writer for advice on this draft. Suggestions stay
                advice; nothing edits your document.
              </p>
              <div className={styles.starters}>
                {STARTER_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    className={styles.starter}
                    isDisabled={!isReady || isStreamingAny}
                    onPress={() => void store.send(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.emptyHint}>
              Open a document in the navigator to chat with your pair writer.
              Every turn reads the open document as it stands.
            </p>
          )
        ) : (
          <ol className={styles.messages}>
            {activeThread.messages.map((message) => {
              if (message.role === "divider") {
                return (
                  <li key={message.id} className={styles.divider}>
                    <span>{message.text}</span>
                  </li>
                );
              }
              if (message.role === "writer") {
                return (
                  <li
                    key={message.id}
                    className={styles.message}
                    data-role="writer"
                  >
                    <span className={styles.speaker}>You</span>
                    {message.selectionQuote ? (
                      <span className={styles.turnMeta}>
                        {`Selection: “${truncate(message.selectionQuote, 60)}”`}
                      </span>
                    ) : null}
                    {message.contextTitles.length > 0 ? (
                      <span className={styles.turnMeta}>
                        {`Context: ${message.contextTitles.join(", ")}`}
                      </span>
                    ) : null}
                    <p className={styles.text}>{message.text}</p>
                  </li>
                );
              }
              return (
                <li
                  key={message.id}
                  className={styles.message}
                  data-role="assistant"
                >
                  <span className={styles.speaker}>Pair writer</span>
                  <div className={styles.assistantCard}>
                    {renderReplyText(message)}
                    {message.stopped ? (
                      <p className={styles.stoppedBadge}>Stopped</p>
                    ) : null}
                    {message.error ? (
                      <div className={styles.inlineError} role="alert">
                        <span>{message.error}</span>
                        <Button
                          className={styles.smallButton}
                          isDisabled={
                            isStreamingAny ||
                            !openDocumentId ||
                            isOtherDocThread
                          }
                          onPress={() =>
                            void store.retry(activeThread.id, message.id)
                          }
                        >
                          <RotateCcw aria-hidden size={13} />
                          <span>Retry</span>
                        </Button>
                      </div>
                    ) : null}
                    {!message.streaming && message.audit ? (
                      <details className={styles.audit}>
                        <summary className={styles.auditSummary}>
                          What it read
                        </summary>
                        <div className={styles.auditBody}>
                          <ul className={styles.sourceList}>
                            {message.audit.sources.map((source, idx) => {
                              const docSnap =
                                (source.kind === "document" ||
                                  source.kind === "contextDocument") &&
                                source.documentId
                                  ? message.audit?.snapshots.find(
                                      (s) => s.documentId === source.documentId,
                                    )
                                  : undefined;
                              return (
                                <li key={idx} className={styles.sourceItem}>
                                  {docSnap && source.documentId ? (
                                    <Button
                                      className={styles.sourceLink}
                                      onPress={() => {
                                        if (
                                          message.audit &&
                                          source.documentId
                                        ) {
                                          openAuditSource(
                                            message.audit,
                                            source.documentId,
                                          );
                                        }
                                      }}
                                    >
                                      <FileText aria-hidden size={13} />
                                      <span>{source.label}</span>
                                    </Button>
                                  ) : (
                                    <span>{source.label}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className={styles.auditFact}>
                            {`Why it ran: ${message.audit.reason}`}
                          </p>
                          <p className={styles.auditFact}>
                            {`Model: ${message.audit.model}`}
                          </p>
                          {message.audit.promptVersion ? (
                            <p className={styles.auditFact}>
                              {`Prompt: ${message.audit.promptVersion}`}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {openDocumentId && !isOtherDocThread ? (
        <div className={styles.readingBar}>
          <div className={styles.readingSummary}>
            <span>
              {`${openDoc?.title ?? "Document"} · ${scopeLabel(openDocScope)} · ${formatWords(openDocReadWords)}`}
            </span>
            {snapshot.extraContext.length > 0 ? (
              <span className={styles.readingTotal}>
                {`Total ${formatWords(readingTotalWords)}`}
              </span>
            ) : null}
          </div>
          <div className={styles.chips}>
            {activeSelection ? (
              <span className={styles.chip} data-kind="selection">
                <span className={styles.chipLabel}>
                  {`Selection: “${truncate(activeSelection.text, 34)}”`}
                </span>
                <Button
                  className={styles.chipRemove}
                  aria-label="Ignore selection for next message"
                  onPress={() => store.ignoreSelection(activeSelection.key)}
                >
                  <X aria-hidden size={12} />
                </Button>
              </span>
            ) : null}
            {snapshot.extraContext.map((doc) => (
              <span key={doc.documentId} className={styles.chip}>
                <span className={styles.chipLabel}>
                  {`${doc.title} (${formatWords(doc.wordCount)})`}
                </span>
                <Button
                  className={styles.chipRemove}
                  aria-label={`Remove ${doc.title} from context`}
                  onPress={() => store.removeContextDocument(doc.documentId)}
                >
                  <X aria-hidden size={12} />
                </Button>
              </span>
            ))}
            <DialogTrigger
              isOpen={contextOpen}
              onOpenChange={(open) => {
                setContextOpen(open);
                if (!open) setContextNote(null);
              }}
            >
              <Button
                className={styles.addContext}
                isDisabled={otherContextCandidates.length === 0}
              >
                <Plus aria-hidden size={12} />
                <span>Context</span>
              </Button>
              <Popover
                className={styles.popover}
                placement="top start"
                offset={4}
              >
                <Dialog
                  className={styles.popoverDialog}
                  aria-label="Add documents to context"
                >
                  <h3 className={styles.sectionHeading}>
                    {`Add documents (${formatWords(remainingContextWords)} remaining)`}
                  </h3>
                  {contextNote ? (
                    <output className={styles.contextError}>
                      {contextNote}
                    </output>
                  ) : null}
                  <ul className={styles.threadList}>
                    {otherContextCandidates.map((doc) => {
                      const added = snapshot.extraContext.some(
                        (c) => c.documentId === doc.id,
                      );
                      const disabled =
                        loadingContextId === doc.id ||
                        (!added && remainingContextWords === 0);
                      return (
                        <li key={doc.id}>
                          <Button
                            className={styles.threadItem}
                            data-current={added ? "true" : undefined}
                            isDisabled={disabled}
                            onPress={() =>
                              void toggleContextDocument(doc.id, doc.title)
                            }
                          >
                            <span className={styles.threadItemTitle}>
                              {doc.title}
                            </span>
                            <span className={styles.threadItemMeta}>
                              {added
                                ? "Added"
                                : remainingContextWords === 0
                                  ? "Limit reached"
                                  : "Add"}
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </Dialog>
              </Popover>
            </DialogTrigger>
          </div>
        </div>
      ) : null}

      {isStreamingAny && !isStreamingHere && streamingThread ? (
        <div className={styles.streamingElsewhere}>
          <span>{`Replying in “${streamingThread.title}”…`}</span>
          <Button
            className={styles.smallButton}
            onPress={() => handleSelectThread(streamingThread.id)}
          >
            View
          </Button>
        </div>
      ) : null}

      <Form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!sendDisabled) void store.send();
        }}
      >
        <TextField
          className={styles.field}
          aria-label="Message the assistant"
          value={snapshot.draft}
          onChange={(value) => store.setDraft(value)}
        >
          <TextArea
            ref={inputRef}
            className={styles.input}
            rows={2}
            placeholder={
              openDocumentId
                ? isOtherDocThread
                  ? "Open this chat’s document to continue"
                  : "Ask your pair writer"
                : "Open a document to ask your pair writer"
            }
            data-focus-target=""
            onKeyDown={onKeyDown}
          />
        </TextField>
        <div className={styles.actions}>
          {isStreamingHere ? (
            <Button
              type="button"
              className={styles.stopButton}
              onPress={() => store.stopStreaming()}
            >
              <Square aria-hidden size={13} />
              <span>Stop</span>
            </Button>
          ) : (
            <Button
              type="submit"
              className={`${controls.iconButton} ${styles.send}`}
              aria-label="Send"
              isDisabled={sendDisabled}
            >
              <ArrowUp aria-hidden size={16} strokeWidth={2.5} />
            </Button>
          )}
        </div>
      </Form>
    </div>
  );
}
