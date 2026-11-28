import { createContext } from "react";
import {
  client,
  type ChatReadSource,
  type ChatReplyDelta,
  type ChatReplyDone,
  type ChatReplyMetrics,
  type CreatePairWriterReplyRequest,
  type PairWriterStatus,
  type Problem,
  type ReadingScope,
} from "../api/client";
import { readSseStream } from "../api/sse";
import type { DocumentSnapshot, EditorBridge } from "./editorBridge";
import {
  buildReadingPlan,
  countWords,
  formatWords,
  READING_LIMIT_WORDS,
  scopeLabel,
  type ContextDocEntry,
  type ReadingPlan,
} from "./reading";

export const STARTER_PROMPTS = [
  "Give me some ideas about how I can improve this text",
  "How can I further develop this text?",
  "What other ideas should I explore?",
] as const;

export interface AssistantStreamError {
  problem?: Problem;
  httpStatus?: number;
  message: string;
}

export interface ReplyStreamHandlers {
  onDelta: (delta: ChatReplyDelta) => void;
  onDone: (done: ChatReplyDone) => void;
  onError: (error: AssistantStreamError) => void;
}

// What answers the writer in the assistant pane. Keeping every service call
// behind this interface confines a replaced endpoint to this module.
export interface Assistant {
  checkReadiness(signal?: AbortSignal): Promise<PairWriterStatus>;
  streamReply(
    request: CreatePairWriterReplyRequest,
    handlers: ReplyStreamHandlers,
    signal: AbortSignal,
  ): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const problemCodes: readonly Problem["code"][] = [
  "malformedRequest",
  "notFound",
  "methodNotAllowed",
  "conflict",
  "payloadTooLarge",
  "unsupportedMediaType",
  "validationFailed",
  "internalError",
  "upstreamFailed",
  "unavailable",
  "upstreamTimeout",
];

function isProblemCode(value: unknown): value is Problem["code"] {
  return (
    typeof value === "string" && problemCodes.some((code) => code === value)
  );
}

function parseProblem(value: unknown): Problem | undefined {
  if (!isRecord(value)) return undefined;
  const { type, title, status, detail, code, errors } = value;
  if (
    typeof type !== "string" ||
    typeof title !== "string" ||
    typeof status !== "number" ||
    typeof detail !== "string" ||
    !isProblemCode(code) ||
    !Array.isArray(errors)
  ) {
    return undefined;
  }
  const fieldErrors: Problem["errors"] = [];
  for (const item of errors) {
    if (
      isRecord(item) &&
      typeof item["pointer"] === "string" &&
      typeof item["detail"] === "string"
    ) {
      fieldErrors.push({
        pointer: item["pointer"],
        detail: item["detail"],
      });
    }
  }
  return { type, title, status, detail, code, errors: fieldErrors };
}

function isSourceKind(value: unknown): value is ChatReadSource["kind"] {
  return (
    value === "document" ||
    value === "selection" ||
    value === "contextDocument" ||
    value === "history"
  );
}

function isReadingScope(value: unknown): value is ReadingScope {
  return (
    value === "whole" || value === "aroundSelection" || value === "aroundCursor"
  );
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parseReplyMetrics(value: unknown): ChatReplyMetrics | null {
  if (!isRecord(value)) return null;
  return {
    firstTokenMs: nullableNumber(value["firstTokenMs"]),
    totalMs: nullableNumber(value["totalMs"]),
    loadMs: nullableNumber(value["loadMs"]),
    promptEvalMs: nullableNumber(value["promptEvalMs"]),
    evalMs: nullableNumber(value["evalMs"]),
    promptTokens: nullableNumber(value["promptTokens"]),
    outputTokens: nullableNumber(value["outputTokens"]),
  };
}

function parseReplyDone(value: unknown): ChatReplyDone | undefined {
  if (!isRecord(value)) return undefined;
  const {
    model,
    promptVersion,
    sources,
    totalWords,
    droppedHistoryTurns,
    metrics,
  } = value;
  if (
    typeof model !== "string" ||
    (promptVersion !== null && typeof promptVersion !== "string") ||
    !Array.isArray(sources) ||
    typeof totalWords !== "number" ||
    typeof droppedHistoryTurns !== "number"
  ) {
    return undefined;
  }
  const parsedSources: ChatReadSource[] = [];
  for (const item of sources) {
    if (!isRecord(item)) continue;
    const { kind, documentId, title, scope, wordCount, label } = item;
    if (
      !isSourceKind(kind) ||
      (documentId !== null && typeof documentId !== "string") ||
      (title !== null && typeof title !== "string") ||
      (scope !== null && !isReadingScope(scope)) ||
      typeof wordCount !== "number" ||
      typeof label !== "string"
    ) {
      continue;
    }
    parsedSources.push({
      kind,
      documentId,
      title,
      scope,
      wordCount,
      label,
    });
  }
  return {
    model,
    promptVersion,
    sources: parsedSources,
    totalWords,
    droppedHistoryTurns,
    metrics: parseReplyMetrics(metrics),
  };
}

// Calls the service's provisional pair-writer endpoints through openapi-fetch
// (`parseAs: "stream"` for SSE), using same-origin `/api/` paths only.
export const serviceAssistant: Assistant = {
  async checkReadiness(signal?: AbortSignal): Promise<PairWriterStatus> {
    try {
      const result = await client.GET("/api/v1/pair-writer", {
        ...(signal ? { signal } : {}),
      });
      if (result.data) return result.data;
      return {
        ready: false,
        provider: null,
        model: null,
        issue: "runtimeUnreachable",
        detail: "Could not check whether the pair writer is ready.",
      };
    } catch {
      return {
        ready: false,
        provider: null,
        model: null,
        issue: "runtimeUnreachable",
        detail:
          "Could not reach the Writer service to check pair-writer readiness.",
      };
    }
  },

  async streamReply(
    request: CreatePairWriterReplyRequest,
    handlers: ReplyStreamHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    let response: Response;
    let initialError: unknown;
    try {
      const result = await client.POST("/api/v1/pair-writer/replies", {
        body: request,
        signal,
        parseAs: "stream",
      });
      response = result.response;
      initialError = result.error;
    } catch {
      if (signal.aborted) return;
      handlers.onError({
        message:
          "Could not reach the pair writer. Check the service and retry.",
      });
      return;
    }

    if (!response.ok) {
      let problem = parseProblem(initialError);
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!problem && contentType.startsWith("application/problem+json")) {
        try {
          problem = parseProblem(await response.json());
        } catch {
          // Ignore malformed error payloads.
        }
      }
      handlers.onError({
        ...(problem ? { problem } : {}),
        httpStatus: response.status,
        message:
          problem?.detail ??
          `The pair writer could not answer (HTTP ${response.status}).`,
      });
      return;
    }

    if (!response.body) {
      handlers.onError({
        message: "The pair writer returned an empty stream.",
      });
      return;
    }

    let finished = false;
    try {
      for await (const event of readSseStream(response.body, signal)) {
        if (signal.aborted) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          continue;
        }
        if (
          event.event === "delta" &&
          isRecord(parsed) &&
          typeof parsed["text"] === "string"
        ) {
          handlers.onDelta({ text: parsed["text"] });
        } else if (event.event === "done") {
          const done = parseReplyDone(parsed);
          if (done) {
            finished = true;
            handlers.onDone(done);
            return;
          }
        } else if (event.event === "error") {
          finished = true;
          const problem = parseProblem(parsed);
          handlers.onError({
            ...(problem ? { problem } : {}),
            ...(problem ? { httpStatus: problem.status } : {}),
            message:
              problem?.detail ??
              "The pair writer stopped before finishing the reply.",
          });
          return;
        }
      }
    } catch {
      if (signal.aborted) return;
      handlers.onError({
        message: "The connection was interrupted before the reply finished.",
      });
      return;
    }

    if (!finished && !signal.aborted) {
      handlers.onError({
        message: "The connection closed before the reply finished.",
      });
    }
  },
};

export const AssistantContext = createContext<Assistant>(serviceAssistant);

export interface ReadOnlySourceView {
  title: string;
  subtitle: string;
  markdown: string;
  documentId: string;
}

export interface CapturedSourceSnapshot {
  documentId: string;
  title: string;
  subtitle: string;
  markdown: string;
}

export interface TurnAudit {
  model: string;
  promptVersion: string | null;
  sources: readonly ChatReadSource[];
  reason: string;
  totalWords: number;
  droppedHistoryTurns: number;
  snapshots: readonly CapturedSourceSnapshot[];
}

export interface WriterMessage {
  id: string;
  role: "writer";
  text: string;
  selectionQuote: string | null;
  contextTitles: readonly string[];
  // Exact full markdown of the open document at the moment this turn was sent,
  // used to detect whether the document changed since this turn.
  openDocFullMarkdown: string;
  // Editor revision and edit version when this turn was sent, so the banner
  // check stays O(1) without serializing large documents during render.
  openDocVersion: string;
  // Exact text read for the open document (whole or windowed), reopened by
  // "View text then".
  openDocReadMarkdown: string;
  openDocScope: ReadingScope;
  openDocWordCount: number;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  text: string;
  readingWords: number;
  streaming: boolean;
  stopped: boolean;
  error: string | null;
  // Writer message text paired with this reply so Retry can resend against
  // the current draft.
  promptText: string;
  audit: TurnAudit | null;
}

export interface DividerMessage {
  id: string;
  role: "divider";
  text: string;
}

export type ThreadMessage = WriterMessage | AssistantMessage | DividerMessage;

export interface ChatThread {
  id: string;
  title: string;
  documentId: string;
  documentTitle: string;
  updatedAt: number;
  unread: boolean;
  messages: readonly ThreadMessage[];
}

export type AssistantSignal = "idle" | "streaming" | "unread";

export interface ReadinessState {
  checked: boolean;
  checking: boolean;
  status: PairWriterStatus | null;
}

export type ChatView = "thread" | "list";

export interface PendingSendInfo {
  threadId: string | null;
  documentId: string;
}

export interface ConversationSnapshot {
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  view: ChatView;
  draft: string;
  readiness: ReadinessState;
  pendingSend: PendingSendInfo | null;
  streamingThreadId: string | null;
  streamingMessageId: string | null;
  extraContext: readonly ContextDocEntry[];
  ignoredSelectionKey: string | null;
  viewingSource: ReadOnlySourceView | null;
  signal: AssistantSignal;
  announcement: { id: number; text: string } | null;
}

function makeThreadTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 46) return collapsed;
  return `${collapsed.slice(0, 44).trimEnd()}…`;
}

function buildReason(prompt: string, hasSelection: boolean): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  const short =
    collapsed.length > 60 ? `${collapsed.slice(0, 58).trimEnd()}…` : collapsed;
  return hasSelection
    ? `You asked “${short}” with a passage selected.`
    : `You asked “${short}”.`;
}

export function selectionKey(
  selection: { text: string; from: number; to: number } | null,
): string | null {
  if (!selection || !selection.text.trim()) return null;
  return `${selection.from}:${selection.to}:${selection.text}`;
}

export function latestWriterTurn(
  thread: ChatThread | null,
): WriterMessage | null {
  if (!thread) return null;
  for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
    const msg = thread.messages[i];
    if (msg?.role === "writer") return msg;
  }
  return null;
}

// Holds all in-memory chat threads, the single active reply stream, `+ Context`
// documents, readiness state, and read-only source inspection. Owned by
// WorkspaceShell so it survives overlaid pane unmount/remount and streaming
// updates never re-render the document editor.
export class ConversationStore {
  private assistant: Assistant;
  private readonly bridge: EditorBridge;
  private readonly listeners = new Set<() => void>();

  private threads: ChatThread[] = [];
  private activeThreadId: string | null = null;
  private view: ChatView = "thread";
  private draft = "";
  private readiness: ReadinessState = {
    checked: false,
    checking: false,
    status: null,
  };
  private streaming: {
    threadId: string;
    messageId: string;
    controller: AbortController;
  } | null = null;
  private pendingSend: {
    threadId: string | null;
    documentId: string;
    controller: AbortController;
    restoreDraft: string | null;
  } | null = null;
  private extraContext: ContextDocEntry[] = [];
  private ignoredSelectionKey: string | null = null;
  private viewingSource: ReadOnlySourceView | null = null;
  private announcement: { id: number; text: string } | null = null;
  private nextAnnouncementId = 1;

  private openDocumentId: string | null = null;
  private openDocumentTitle = "";
  private assistantOpen = false;
  private pendingTargetThread: { documentId: string; threadId: string } | null =
    null;

  private cachedSnapshot: ConversationSnapshot | null = null;

  constructor(assistant: Assistant, bridge: EditorBridge) {
    this.assistant = assistant;
    this.bridge = bridge;
  }

  setAssistant(assistant: Assistant): void {
    this.assistant = assistant;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConversationSnapshot => {
    if (!this.cachedSnapshot) {
      const signal: AssistantSignal =
        this.streaming || this.pendingSend
          ? "streaming"
          : this.threads.some((thread) => thread.unread)
            ? "unread"
            : "idle";
      this.cachedSnapshot = {
        threads: this.threads,
        activeThreadId: this.activeThreadId,
        view: this.view,
        draft: this.draft,
        readiness: this.readiness,
        pendingSend: this.pendingSend
          ? {
              threadId: this.pendingSend.threadId,
              documentId: this.pendingSend.documentId,
            }
          : null,
        streamingThreadId: this.streaming?.threadId ?? null,
        streamingMessageId: this.streaming?.messageId ?? null,
        extraContext: this.extraContext,
        ignoredSelectionKey: this.ignoredSelectionKey,
        viewingSource: this.viewingSource,
        signal,
        announcement: this.announcement,
      };
    }
    return this.cachedSnapshot;
  };

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    if (this.pendingSend) {
      this.pendingSend.controller.abort();
      this.pendingSend = null;
    }
    if (this.streaming) {
      this.streaming.controller.abort();
      this.streaming = null;
    }
  }

  setAssistantOpen(open: boolean): void {
    const becameOpen = open && !this.assistantOpen;
    this.assistantOpen = open;
    if (open && this.view === "thread" && this.activeThreadId) {
      this.markThreadRead(this.activeThreadId);
    }
    if (becameOpen) {
      void this.checkReadiness();
    }
  }

  setOpenDocument(documentId: string | null, title: string): void {
    const changedDoc = documentId !== this.openDocumentId;
    this.openDocumentId = documentId;
    this.openDocumentTitle = title;

    if (!changedDoc) {
      // Keep matching threads' documentTitle up to date after a rename.
      if (documentId && title) {
        let updated = false;
        this.threads = this.threads.map((thread) => {
          if (
            thread.documentId === documentId &&
            thread.documentTitle !== title
          ) {
            updated = true;
            return { ...thread, documentTitle: title };
          }
          return thread;
        });
        if (updated) this.emit();
      }
      return;
    }

    this.extraContext = [];
    this.ignoredSelectionKey = null;
    this.viewingSource = null;
    this.view = "thread";

    if (documentId) {
      if (
        this.pendingTargetThread &&
        this.pendingTargetThread.documentId === documentId &&
        this.threads.some((t) => t.id === this.pendingTargetThread?.threadId)
      ) {
        this.activeThreadId = this.pendingTargetThread.threadId;
        this.pendingTargetThread = null;
      } else {
        const latest = this.threads.find((t) => t.documentId === documentId);
        this.activeThreadId = latest?.id ?? null;
      }
      if (this.assistantOpen && this.activeThreadId) {
        this.markThreadReadSilent(this.activeThreadId);
      }
    } else {
      this.activeThreadId = null;
      this.pendingTargetThread = null;
    }
    this.emit();
  }

  prepareOpenDocumentForThread(threadId: string): string | null {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return null;
    this.pendingTargetThread = {
      documentId: thread.documentId,
      threadId: thread.id,
    };
    return thread.documentId;
  }

  syncWorkspaceTitles(titlesById: ReadonlyMap<string, string>): void {
    let changed = false;
    this.threads = this.threads.map((thread) => {
      const nextTitle = titlesById.get(thread.documentId);
      if (nextTitle && nextTitle !== thread.documentTitle) {
        changed = true;
        return { ...thread, documentTitle: nextTitle };
      }
      return thread;
    });
    if (changed) this.emit();
  }

  async checkReadiness(signal?: AbortSignal): Promise<PairWriterStatus | null> {
    this.readiness = { ...this.readiness, checking: true };
    this.emit();
    const status = await this.assistant.checkReadiness(signal);
    if (signal?.aborted) {
      this.readiness = { ...this.readiness, checking: false };
      this.emit();
      return null;
    }
    this.readiness = { checked: true, checking: false, status };
    this.emit();
    return status;
  }

  setDraft(draft: string): void {
    if (this.draft === draft) return;
    this.draft = draft;
    this.emit();
  }

  showThreadList(): void {
    if (this.view === "list") return;
    this.view = "list";
    this.emit();
  }

  startNewThread(): void {
    this.activeThreadId = null;
    this.view = "thread";
    this.emit();
  }

  selectThread(threadId: string): void {
    if (!this.threads.some((t) => t.id === threadId)) return;
    this.activeThreadId = threadId;
    this.view = "thread";
    if (this.assistantOpen) {
      this.markThreadReadSilent(threadId);
    }
    this.emit();
  }

  deleteThread(threadId: string): void {
    if (this.pendingSend?.threadId === threadId) {
      this.pendingSend.controller.abort();
      this.pendingSend = null;
    }
    if (this.streaming?.threadId === threadId) {
      this.streaming.controller.abort();
      this.streaming = null;
    }
    const before = this.threads.length;
    this.threads = this.threads.filter((t) => t.id !== threadId);
    if (this.threads.length === before) return;
    if (this.activeThreadId === threadId) {
      this.activeThreadId = null;
    }
    this.emit();
  }

  ignoreSelection(key: string): void {
    this.ignoredSelectionKey = key;
    if (this.openDocumentId) {
      this.bridge.setSelectionIgnored(this.openDocumentId, true);
    }
    this.emit();
  }

  clearIgnoredSelection(): void {
    if (this.ignoredSelectionKey === null) return;
    this.ignoredSelectionKey = null;
    if (this.openDocumentId) {
      this.bridge.setSelectionIgnored(this.openDocumentId, false);
    }
    this.emit();
  }

  addContextDocument(entry: ContextDocEntry): void {
    if (entry.documentId === this.openDocumentId) return;
    if (this.extraContext.some((c) => c.documentId === entry.documentId))
      return;
    this.extraContext = [...this.extraContext, entry];
    this.emit();
  }

  removeContextDocument(documentId: string): void {
    const next = this.extraContext.filter((c) => c.documentId !== documentId);
    if (next.length === this.extraContext.length) return;
    this.extraContext = next;
    this.emit();
  }

  openSource(source: ReadOnlySourceView): void {
    this.viewingSource = source;
    this.emit();
  }

  closeSource(): void {
    if (!this.viewingSource) return;
    this.viewingSource = null;
    this.emit();
  }

  stopStreaming(): void {
    if (this.pendingSend) {
      const { controller, restoreDraft } = this.pendingSend;
      this.pendingSend = null;
      controller.abort();
      if (restoreDraft !== null && this.draft === "") {
        this.draft = restoreDraft;
      }
      this.emit();
      return;
    }
    if (!this.streaming) return;
    const { threadId, messageId, controller } = this.streaming;
    this.streaming = null;
    controller.abort();
    this.updateAssistantMessage(threadId, messageId, (msg) => ({
      ...msg,
      streaming: false,
      stopped: true,
    }));
  }

  async send(explicitPrompt?: string): Promise<void> {
    if (this.streaming || this.pendingSend) return;
    const documentId = this.openDocumentId;
    if (!documentId) return;

    const active = this.activeThreadId
      ? (this.threads.find((t) => t.id === this.activeThreadId) ?? null)
      : null;
    if (active && active.documentId !== documentId) return;

    const text = (explicitPrompt ?? this.draft).trim();
    if (!text) return;

    // Capture the live document snapshot and context synchronously so switching
    // documents while readiness answers never sends an empty or mismatched draft.
    const capturedSnapshot = this.bridge.readSnapshot(documentId);
    if (!capturedSnapshot) return;
    const documentTitle = this.openDocumentTitle || "Untitled";
    const capturedContext = [...this.extraContext];
    const capturedIgnoredSelectionKey = this.ignoredSelectionKey;
    const restoreDraft = explicitPrompt === undefined ? this.draft : null;

    const controller = new AbortController();
    this.pendingSend = {
      threadId: active?.id ?? null,
      documentId,
      controller,
      restoreDraft,
    };
    if (explicitPrompt === undefined) {
      this.draft = "";
    }
    this.emit();

    const status = await this.checkReadiness(controller.signal);
    if (
      controller.signal.aborted ||
      this.pendingSend?.controller !== controller
    ) {
      return;
    }
    this.pendingSend = null;
    if (!status?.ready) {
      // Keep the writer's typed message intact when the pair writer is not ready.
      if (restoreDraft !== null && this.draft === "") {
        this.draft = restoreDraft;
      }
      this.emit();
      return;
    }

    const latestActive = active
      ? (this.threads.find((t) => t.id === active.id) ?? null)
      : null;
    if (active && !latestActive) {
      this.emit();
      return;
    }

    this.startTurn({
      text,
      documentId,
      documentTitle,
      existingThread: latestActive,
      capturedSnapshot,
      capturedContext,
      capturedIgnoredSelectionKey,
      replaceFailedMessageId: null,
    });
  }

  async retry(threadId: string, failedMessageId: string): Promise<void> {
    if (this.streaming || this.pendingSend) return;
    const documentId = this.openDocumentId;
    if (!documentId) return;
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread || thread.documentId !== documentId) return;
    const failed = thread.messages.find(
      (m): m is AssistantMessage =>
        m.role === "assistant" && m.id === failedMessageId,
    );
    if (!failed) return;

    const capturedSnapshot = this.bridge.readSnapshot(documentId);
    if (!capturedSnapshot) return;
    const documentTitle = this.openDocumentTitle || thread.documentTitle;
    const capturedContext = [...this.extraContext];
    const capturedIgnoredSelectionKey = this.ignoredSelectionKey;

    const controller = new AbortController();
    this.pendingSend = {
      threadId,
      documentId,
      controller,
      restoreDraft: null,
    };
    this.emit();

    const status = await this.checkReadiness(controller.signal);
    if (
      controller.signal.aborted ||
      this.pendingSend?.controller !== controller
    ) {
      return;
    }
    this.pendingSend = null;
    if (!status?.ready) {
      this.emit();
      return;
    }

    const latestThread = this.threads.find((t) => t.id === threadId);
    if (!latestThread) {
      this.emit();
      return;
    }

    this.startTurn({
      text: failed.promptText,
      documentId,
      documentTitle,
      existingThread: latestThread,
      capturedSnapshot,
      capturedContext,
      capturedIgnoredSelectionKey,
      replaceFailedMessageId: failedMessageId,
    });
  }

  private startTurn(params: {
    text: string;
    documentId: string;
    documentTitle: string;
    existingThread: ChatThread | null;
    capturedSnapshot: DocumentSnapshot;
    capturedContext: readonly ContextDocEntry[];
    capturedIgnoredSelectionKey: string | null;
    replaceFailedMessageId: string | null;
  }): void {
    const { capturedSnapshot } = params;
    const liveMarkdown = capturedSnapshot.markdown;
    const cursorOffset = capturedSnapshot.cursorOffset;
    const rawSelection = capturedSnapshot.selection;
    const currentSelKey = selectionKey(rawSelection);
    const useSelection =
      rawSelection !== null &&
      currentSelKey !== params.capturedIgnoredSelectionKey;
    const activeSelection = useSelection ? rawSelection.text.trim() : null;
    const selectionOffset = useSelection
      ? capturedSnapshot.selectionOffset
      : null;

    // Build history from existing thread (excluding dividers, errors, or the
    // failed turn being retried).
    const baseMessages = params.existingThread
      ? params.replaceFailedMessageId
        ? dropFailedTurn(
            params.existingThread.messages,
            params.replaceFailedMessageId,
          )
        : [...params.existingThread.messages]
      : [];

    const history = baseMessages
      .filter(
        (m): m is WriterMessage | AssistantMessage =>
          m.role === "writer" ||
          (m.role === "assistant" && !m.error && m.text.trim().length > 0),
      )
      .map((m) => ({ role: m.role, text: m.text }));

    const plan: ReadingPlan = buildReadingPlan({
      documentId: params.documentId,
      documentTitle: params.documentTitle,
      markdown: liveMarkdown,
      selection: activeSelection,
      cursorOffset,
      selectionOffset,
      contextDocuments: params.capturedContext,
      history,
    });

    const previousWriter = latestWriterTurn(
      params.existingThread
        ? { ...params.existingThread, messages: baseMessages }
        : null,
    );
    const documentEditedSincePrevious =
      previousWriter !== null &&
      previousWriter.openDocFullMarkdown !== liveMarkdown;

    const now = Date.now();
    const writerMsg: WriterMessage = {
      id: crypto.randomUUID(),
      role: "writer",
      text: params.text,
      selectionQuote: plan.selection,
      contextTitles: plan.contextDocuments.map((d) => d.title),
      openDocFullMarkdown: liveMarkdown,
      openDocVersion: capturedSnapshot.version,
      openDocReadMarkdown: plan.documentText,
      openDocScope: plan.documentScope,
      openDocWordCount: plan.documentWordCount,
    };

    const capturedSnapshots: CapturedSourceSnapshot[] = [
      {
        documentId: plan.documentId,
        title: plan.documentTitle,
        subtitle: `${scopeLabel(plan.documentScope)} · ${formatWords(plan.documentWordCount)}`,
        markdown: plan.documentText,
      },
      ...plan.contextDocuments.map((doc) => ({
        documentId: doc.documentId,
        title: doc.title,
        subtitle: `added · ${formatWords(doc.wordCount)}`,
        markdown: doc.markdown,
      })),
    ];

    const fallbackSources: ChatReadSource[] = [
      {
        kind: "document",
        documentId: plan.documentId,
        title: plan.documentTitle,
        scope: plan.documentScope,
        wordCount: plan.documentWordCount,
        label: plan.summaryLabel,
      },
      ...(plan.selection
        ? [
            {
              kind: "selection" as const,
              documentId: plan.documentId,
              title: plan.documentTitle,
              scope: null,
              wordCount: countWords(plan.selection),
              label: `Selection · ${formatWords(countWords(plan.selection))}`,
            },
          ]
        : []),
      ...plan.contextDocuments.map((doc) => ({
        kind: "contextDocument" as const,
        documentId: doc.documentId,
        title: doc.title,
        scope: "whole" as const,
        wordCount: doc.wordCount,
        label: `${doc.title} · added · ${formatWords(doc.wordCount)}`,
      })),
    ];

    const reason = buildReason(params.text, plan.selection !== null);

    const assistantMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      readingWords: plan.totalWords,
      streaming: true,
      stopped: false,
      error: null,
      promptText: params.text,
      audit: {
        model: this.readiness.status?.model ?? "scripted-pair-writer",
        promptVersion: null,
        sources: fallbackSources,
        reason,
        totalWords: plan.totalWords,
        droppedHistoryTurns: plan.droppedHistoryTurns,
        snapshots: capturedSnapshots,
      },
    };

    const appended: ThreadMessage[] = [
      ...baseMessages,
      ...(documentEditedSincePrevious
        ? [
            {
              id: crypto.randomUUID(),
              role: "divider" as const,
              text: "Continuing against the current draft",
            },
          ]
        : []),
      writerMsg,
      assistantMsg,
    ];

    let threadId: string;
    if (params.existingThread) {
      threadId = params.existingThread.id;
      const updatedThread: ChatThread = {
        ...params.existingThread,
        documentTitle: params.documentTitle,
        updatedAt: now,
        unread: false,
        messages: appended,
      };
      this.threads = [
        updatedThread,
        ...this.threads.filter((t) => t.id !== threadId),
      ];
    } else {
      threadId = crypto.randomUUID();
      const newThread: ChatThread = {
        id: threadId,
        title: makeThreadTitle(params.text),
        documentId: params.documentId,
        documentTitle: params.documentTitle,
        updatedAt: now,
        unread: false,
        messages: appended,
      };
      this.threads = [newThread, ...this.threads];
      // Only switch activeThreadId if the writer is still on this document's
      // new-chat view; if they switched documents or threads while readiness
      // was checked, let the reply stream into its own thread in the background.
      if (
        this.openDocumentId === params.documentId &&
        this.activeThreadId === null
      ) {
        this.activeThreadId = threadId;
      }
    }

    if (
      this.openDocumentId === params.documentId &&
      this.ignoredSelectionKey !== null
    ) {
      this.ignoredSelectionKey = null;
      this.bridge.setSelectionIgnored(params.documentId, false);
    }

    const controller = new AbortController();
    this.streaming = {
      threadId,
      messageId: assistantMsg.id,
      controller,
    };
    this.emit();

    const apiRequest: CreatePairWriterReplyRequest = {
      message: params.text,
      document: {
        documentId: plan.documentId,
        title: plan.documentTitle,
        content: plan.documentText,
        scope: plan.documentScope,
        cursorOffset: selectionOffset ?? cursorOffset,
      },
      ...(plan.selection ? { selection: { text: plan.selection } } : {}),
      contextDocuments: plan.contextDocuments.map((doc) => ({
        documentId: doc.documentId,
        title: doc.title,
        content: doc.markdown,
      })),
      history: [...plan.history],
    };

    void this.assistant.streamReply(
      apiRequest,
      {
        onDelta: (delta) => {
          if (this.streaming?.messageId !== assistantMsg.id) return;
          this.updateAssistantMessage(threadId, assistantMsg.id, (msg) => ({
            ...msg,
            text: msg.text + delta.text,
          }));
        },
        onDone: (done) => {
          if (this.streaming?.messageId !== assistantMsg.id) return;
          this.streaming = null;
          const unseen =
            !this.assistantOpen ||
            this.view !== "thread" ||
            this.activeThreadId !== threadId;
          const thread = this.threads.find((t) => t.id === threadId);
          const updated = this.threads.map((t) => {
            if (t.id !== threadId) return t;
            return {
              ...t,
              updatedAt: Date.now(),
              unread: unseen ? true : t.unread,
              messages: t.messages.map((m) =>
                m.role === "assistant" && m.id === assistantMsg.id
                  ? {
                      ...m,
                      streaming: false,
                      audit: {
                        model: done.model,
                        promptVersion: done.promptVersion,
                        sources: done.sources,
                        reason,
                        totalWords: done.totalWords,
                        droppedHistoryTurns: done.droppedHistoryTurns,
                        snapshots: capturedSnapshots,
                      },
                    }
                  : m,
              ),
            };
          });
          const finished = updated.find((t) => t.id === threadId);
          this.threads = finished
            ? [finished, ...updated.filter((t) => t.id !== threadId)]
            : updated;
          this.announcement = {
            id: this.nextAnnouncementId++,
            text: thread
              ? `Pair writer finished replying in ${thread.title}.`
              : "Pair writer finished replying.",
          };
          this.emit();
        },
        onError: (err) => {
          if (this.streaming?.messageId !== assistantMsg.id) return;
          this.streaming = null;
          if (err.problem?.code === "unavailable") {
            void this.checkReadiness();
          }
          this.updateAssistantMessage(threadId, assistantMsg.id, (msg) => ({
            ...msg,
            streaming: false,
            error: err.message,
          }));
        },
      },
      controller.signal,
    );
  }

  private markThreadReadSilent(threadId: string): boolean {
    let changed = false;
    this.threads = this.threads.map((t) => {
      if (t.id === threadId && t.unread) {
        changed = true;
        return { ...t, unread: false };
      }
      return t;
    });
    return changed;
  }

  private markThreadRead(threadId: string): void {
    if (this.markThreadReadSilent(threadId)) this.emit();
  }

  private updateAssistantMessage(
    threadId: string,
    messageId: string,
    updater: (msg: AssistantMessage) => AssistantMessage,
  ): void {
    this.threads = this.threads.map((t) => {
      if (t.id !== threadId) return t;
      return {
        ...t,
        messages: t.messages.map((m) =>
          m.role === "assistant" && m.id === messageId ? updater(m) : m,
        ),
      };
    });
    this.emit();
  }
}

function dropFailedTurn(
  messages: readonly ThreadMessage[],
  failedMessageId: string,
): ThreadMessage[] {
  const index = messages.findIndex((m) => m.id === failedMessageId);
  if (index === -1) return [...messages];
  const prev = messages[index - 1];
  const start = prev?.role === "writer" ? index - 1 : index;
  return [...messages.slice(0, start), ...messages.slice(index + 1)];
}

export { READING_LIMIT_WORDS };
