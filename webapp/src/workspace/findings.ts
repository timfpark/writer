import type {
  FindingAudit,
  FindingCategory,
  ReviewAgentKind,
  ReviewFinding,
} from "../api/client";
import type { Assistant, ReadOnlySourceView } from "./conversation";
import type {
  EditorBridge,
  EditorTransactionReport,
  FindingDecorationRange,
  FindingUnderlineStyle,
  PassageDescriptor,
} from "./editorBridge";
import { formatWords } from "./reading";

// ADR 0011 quiet window on AC power (2.5 to 3 s).
export const PAUSE_WINDOW_MS = 2_600;

// ADR 0011 density caps so short drafts stay calm.
export const MAX_FINDINGS_PER_SCENE = 3;
export const MAX_FINDINGS_PER_DOCUMENT = 6;

export const PAUSED_STORAGE_KEY = "writer.assistant.paused";

export type FindingFilter =
  "all" | "prose" | "continuity" | "questions" | "chapter" | "rules";

export const FINDING_FILTERS: readonly {
  id: FindingFilter;
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "prose", label: "Prose" },
  { id: "continuity", label: "Continuity" },
  { id: "questions", label: "Questions" },
  { id: "chapter", label: "Chapter" },
  { id: "rules", label: "Rules" },
];

export type ReviewStatus = "idle" | "waiting" | "reviewing" | "paused";

export interface TrackedFinding {
  findingId: string;
  documentId: string;
  passageId: string;
  sceneIndex: number;
  agent: ReviewAgentKind;
  agentLabel: string;
  category: FindingCategory;
  confidence: number;
  note: string;
  quote: string;
  style: FindingUnderlineStyle;
  status: "active" | "changed";
  from: number;
  to: number;
  audit: FindingAudit;
  sourceSnapshot: ReadOnlySourceView;
}

export interface FindingsSnapshot {
  documentId: string | null;
  findings: readonly TrackedFinding[];
  activeCount: number;
  selectedFindingId: string | null;
  filter: FindingFilter;
  paused: boolean;
  reviewStatus: ReviewStatus;
  reviewing: boolean;
  announcement: { id: number; text: string } | null;
}

// Fast deterministic 64-bit FNV-1a digest over passage text so pause review
// can skip unchanged passages without async crypto overhead.
export function hashPassageText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 ^= ch & 0xff;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch >>> 8;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

interface HashedPassage extends PassageDescriptor {
  contentHash: string;
}

interface PendingReviewBatch {
  documentId: string;
  passageIds: ReadonlySet<string>;
  passagesById: ReadonlyMap<string, HashedPassage>;
  findings: readonly ReviewFinding[];
}

interface InFlightReview {
  documentId: string;
  passageIds: ReadonlySet<string>;
  controller: AbortController;
}

function readStoredPaused(): boolean {
  try {
    return globalThis.localStorage.getItem(PAUSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredPaused(paused: boolean): void {
  try {
    globalThis.localStorage.setItem(PAUSED_STORAGE_KEY, String(paused));
  } catch {
    // Ignore storage errors; preference lasts for this session.
  }
}

function underlineStyleFor(agent: ReviewAgentKind): FindingUnderlineStyle {
  return agent === "openQuestions" ? "question" : "prose";
}

function dismissalKey(agent: ReviewAgentKind, quote: string): string {
  return `${agent}\0${quote}`;
}

function stripEmphasisMarkers(text: string): string {
  return text.replace(/\*([^*]+)\*/g, "$1");
}

function countLabel(count: number): string {
  if (count === 0) return "No findings in this document.";
  if (count === 1) return "1 finding in this document.";
  return `${count} findings in this document.`;
}

// Applies ADR 0011's density caps (max 3 per scene, max 6 per chapter, no
// overlapping underlines, highest-confidence first) to active findings while
// preserving changed cards awaiting the next pause review.
export function applyDensityCaps(
  candidates: readonly TrackedFinding[],
): TrackedFinding[] {
  const changed = candidates.filter((f) => f.status === "changed");
  const active = candidates
    .filter((f) => f.status === "active")
    .sort((a, b) => b.confidence - a.confidence || a.from - b.from);

  const keptActive: TrackedFinding[] = [];
  const perScene = new Map<number, number>();

  for (const finding of active) {
    if (keptActive.length >= MAX_FINDINGS_PER_DOCUMENT) break;
    const sceneCount = perScene.get(finding.sceneIndex) ?? 0;
    if (sceneCount >= MAX_FINDINGS_PER_SCENE) continue;
    const overlaps = keptActive.some(
      (existing) => existing.from < finding.to && finding.from < existing.to,
    );
    if (overlaps) continue;
    keptActive.push(finding);
    perScene.set(finding.sceneIndex, sceneCount + 1);
  }

  return [...keptActive, ...changed].sort((a, b) => a.from - b.from);
}

export interface FindingsStoreOptions {
  pauseWindowMs?: number;
  onUnavailable?: () => void;
}

// Manages ADR 0011/0012 pause-triggered background review, passage underline
// decorations, edit-versus-delete lifecycle, density caps, dismissals, Pause,
// and F8 navigation. Owned by WorkspaceShell so it survives overlaid pane
// unmount/remount and never re-renders the editor while typing.
export class FindingsStore {
  private assistant: Assistant;
  private readonly bridge: EditorBridge;
  private readonly pauseWindowMs: number;
  private readonly onUnavailable: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly unsubTransaction: () => void;

  private openDocumentId: string | null = null;
  private openDocumentTitle = "";
  private findings: TrackedFinding[] = [];
  private selectedFindingId: string | null = null;
  private filter: FindingFilter = "all";
  private paused: boolean;
  private chatBusy = false;
  private typingActive = false;

  private readonly dirtyPassageIds = new Set<string>();
  private readonly reviewedHashes = new Map<string, string>();
  private readonly dismissalsByDoc = new Map<string, Set<string>>();
  private heldReviews: PendingReviewBatch[] = [];
  private inFlight: InFlightReview | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  private announcement: { id: number; text: string } | null = null;
  private nextAnnouncementId = 1;
  private cachedSnapshot: FindingsSnapshot | null = null;

  constructor(
    assistant: Assistant,
    bridge: EditorBridge,
    options: FindingsStoreOptions = {},
  ) {
    this.assistant = assistant;
    this.bridge = bridge;
    this.pauseWindowMs = options.pauseWindowMs ?? PAUSE_WINDOW_MS;
    this.onUnavailable = options.onUnavailable;
    this.paused = readStoredPaused();
    this.unsubTransaction = this.bridge.onTransaction((report) => {
      this.handleTransaction(report);
    });
  }

  setAssistant(assistant: Assistant): void {
    this.assistant = assistant;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FindingsSnapshot => {
    if (!this.cachedSnapshot) {
      let activeCount = 0;
      for (const f of this.findings) {
        if (f.status === "active") activeCount += 1;
      }
      const reviewStatus: ReviewStatus = this.paused
        ? "paused"
        : this.inFlight
          ? "reviewing"
          : this.typingActive ||
              this.dirtyPassageIds.size > 0 ||
              this.heldReviews.length > 0
            ? "waiting"
            : "idle";
      this.cachedSnapshot = {
        documentId: this.openDocumentId,
        findings: this.findings,
        activeCount,
        selectedFindingId: this.selectedFindingId,
        filter: this.filter,
        paused: this.paused,
        reviewStatus,
        reviewing: this.inFlight !== null,
        announcement: this.announcement,
      };
    }
    return this.cachedSnapshot;
  };

  dispose(): void {
    this.unsubTransaction();
    this.clearPauseTimer();
    this.abortInFlight(false);
  }

  setOpenDocument(documentId: string | null, title: string): void {
    if (documentId === this.openDocumentId) {
      this.openDocumentTitle = title;
      return;
    }
    this.clearPauseTimer();
    this.abortInFlight(false);
    this.openDocumentId = documentId;
    this.openDocumentTitle = title;
    this.findings = [];
    this.selectedFindingId = null;
    this.filter = "all";
    this.typingActive = false;
    this.dirtyPassageIds.clear();
    this.reviewedHashes.clear();
    this.heldReviews = [];
    this.emit();
  }

  setFilter(filter: FindingFilter): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.emit();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    writeStoredPaused(paused);
    if (paused) {
      this.clearPauseTimer();
      this.abortInFlight(true);
      this.announce("Background review paused.");
    } else {
      this.announce("Background review resumed.");
      if (
        !this.chatBusy &&
        this.openDocumentId &&
        (this.dirtyPassageIds.size > 0 || this.heldReviews.length > 0)
      ) {
        this.schedulePauseTimer();
      }
    }
    this.emit();
  }

  togglePaused(): void {
    this.setPaused(!this.paused);
  }

  setChatBusy(busy: boolean): void {
    if (this.chatBusy === busy) return;
    this.chatBusy = busy;
    if (busy) {
      // ADR 0012: a chat message stops background review until its reply ends.
      this.clearPauseTimer();
      this.abortInFlight(true);
      this.emit();
      return;
    }
    if (
      !this.paused &&
      this.openDocumentId &&
      (this.dirtyPassageIds.size > 0 || this.heldReviews.length > 0)
    ) {
      this.schedulePauseTimer();
    }
    this.emit();
  }

  dismissFinding(findingId: string): void {
    const target = this.findings.find((f) => f.findingId === findingId);
    if (!target) return;

    if (target.status === "active") {
      const set =
        this.dismissalsByDoc.get(target.documentId) ?? new Set<string>();
      set.add(dismissalKey(target.agent, target.quote));
      this.dismissalsByDoc.set(target.documentId, set);
    }

    this.findings = this.findings.filter((f) => f.findingId !== findingId);
    if (this.selectedFindingId === findingId) {
      this.selectedFindingId = null;
    }
    this.syncDecorations();
    this.emit();
  }

  selectFinding(
    findingId: string,
    options: { moveCaret?: boolean; announce?: boolean } = {},
  ): TrackedFinding | null {
    const target = this.findings.find((f) => f.findingId === findingId);
    if (!target) return null;

    this.selectedFindingId = findingId;
    if (this.filter !== "all" && target.category !== this.filter) {
      this.filter = "all";
    }
    this.syncDecorations();

    if (
      target.status === "active" &&
      this.openDocumentId === target.documentId
    ) {
      this.bridge.focusFindingRange(
        target.documentId,
        target.from,
        target.to,
        options.moveCaret ?? false,
      );
    }

    if (options.announce) {
      this.announce(
        `${target.agentLabel}: ${stripEmphasisMarkers(target.note)}`,
      );
    }
    this.emit();
    return target;
  }

  stepFinding(direction: 1 | -1): TrackedFinding | null {
    const active = this.findings.filter((f) => f.status === "active");
    if (active.length === 0) {
      this.announce("No findings in this document.");
      this.emit();
      return null;
    }
    const currentIndex = this.selectedFindingId
      ? active.findIndex((f) => f.findingId === this.selectedFindingId)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : active.length - 1
        : (currentIndex + direction + active.length) % active.length;
    const target = active[nextIndex];
    if (!target) return null;
    return this.selectFinding(target.findingId, {
      moveCaret: true,
      announce: true,
    });
  }

  private handleTransaction(report: EditorTransactionReport): void {
    if (!this.openDocumentId || report.documentId !== this.openDocumentId) {
      return;
    }

    let stateChanged = false;
    let deletedCount = 0;

    if (report.findingUpdates.length > 0 && this.findings.length > 0) {
      const byId = new Map(report.findingUpdates.map((u) => [u.findingId, u]));
      const next: TrackedFinding[] = [];
      for (const finding of this.findings) {
        const update = byId.get(finding.findingId);
        if (!update) {
          next.push(finding);
          continue;
        }
        if (update.status === "deleted") {
          deletedCount += 1;
          stateChanged = true;
          if (this.selectedFindingId === finding.findingId) {
            this.selectedFindingId = null;
          }
          continue;
        }
        if (
          finding.from !== update.from ||
          finding.to !== update.to ||
          finding.status !== update.status
        ) {
          stateChanged = true;
          next.push({
            ...finding,
            from: update.from,
            to: update.to,
            status: update.status,
          });
        } else {
          next.push(finding);
        }
      }
      if (stateChanged) {
        this.findings = next.sort((a, b) => a.from - b.from);
      }
    }

    if (deletedCount > 0) {
      this.announce(
        deletedCount === 1
          ? "Removed finding for deleted passage."
          : `Removed ${deletedCount} findings for deleted passages.`,
      );
    }

    if (report.editedPassageIds.length > 0) {
      for (const id of report.editedPassageIds) {
        this.dirtyPassageIds.add(id);
      }

      // Drop stale held findings for passages edited before the next pause.
      if (this.heldReviews.length > 0) {
        const editedSet = new Set(report.editedPassageIds);
        const filteredHeld: PendingReviewBatch[] = [];
        for (const batch of this.heldReviews) {
          const remainingIds = new Set(
            [...batch.passageIds].filter((id) => !editedSet.has(id)),
          );
          if (remainingIds.size > 0) {
            filteredHeld.push({
              ...batch,
              passageIds: remainingIds,
              findings: batch.findings.filter((f) =>
                remainingIds.has(f.anchor.passageId),
              ),
            });
          }
        }
        this.heldReviews = filteredHeld;
      }

      // ADR 0012: cancel an in-flight review only when an edit changes a
      // passage it is reviewing; otherwise let it finish and hold its underlines.
      if (this.inFlight) {
        const touchesReviewed = report.editedPassageIds.some((id) =>
          this.inFlight?.passageIds.has(id),
        );
        if (touchesReviewed) {
          this.abortInFlight(true);
          stateChanged = true;
        }
      }

      const wasTyping = this.typingActive;
      this.typingActive = true;
      if (!wasTyping) stateChanged = true;

      this.clearPauseTimer();
      if (!this.paused && !this.chatBusy) {
        this.schedulePauseTimer();
      }
    }

    if (stateChanged) {
      this.emit();
    }
  }

  private schedulePauseTimer(): void {
    this.clearPauseTimer();
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.onPauseElapsed();
    }, this.pauseWindowMs);
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private onPauseElapsed(): void {
    this.typingActive = false;

    if (this.heldReviews.length > 0) {
      const batches = this.heldReviews;
      this.heldReviews = [];
      for (const batch of batches) {
        if (batch.documentId === this.openDocumentId) {
          this.applyReviewBatch(batch);
        }
      }
    }

    if (
      !this.paused &&
      !this.chatBusy &&
      !this.inFlight &&
      this.openDocumentId &&
      this.dirtyPassageIds.size > 0
    ) {
      this.startReview();
      return;
    }

    this.emit();
  }

  private startReview(): void {
    const documentId = this.openDocumentId;
    if (!documentId || this.paused || this.chatBusy || this.inFlight) return;

    const candidateIds = new Set(this.dirtyPassageIds);
    this.dirtyPassageIds.clear();

    const descriptors = this.bridge.readPassages(documentId, candidateIds);
    const presentIds = new Set(descriptors.map((d) => d.passageId));

    // Remove findings whose passages became empty or non-prose.
    const vanishedIds = new Set(
      [...candidateIds].filter((id) => !presentIds.has(id)),
    );
    if (vanishedIds.size > 0) {
      const before = this.findings.length;
      this.findings = this.findings.filter(
        (f) => !vanishedIds.has(f.passageId),
      );
      if (this.findings.length !== before) {
        if (
          this.selectedFindingId &&
          !this.findings.some((f) => f.findingId === this.selectedFindingId)
        ) {
          this.selectedFindingId = null;
        }
        this.syncDecorations();
      }
    }

    // Only send passages whose content hash changed since the last review.
    const changedPassages: HashedPassage[] = descriptors
      .map((p) => ({ ...p, contentHash: hashPassageText(p.text) }))
      .filter((p) => this.reviewedHashes.get(p.passageId) !== p.contentHash);
    if (changedPassages.length === 0) {
      this.emit();
      return;
    }

    const passageIds = new Set(changedPassages.map((p) => p.passageId));
    const passagesById = new Map(
      changedPassages.map((p) => [p.passageId, p] as const),
    );
    const controller = new AbortController();
    this.inFlight = { documentId, passageIds, controller };
    this.emit();

    const wordCount =
      this.bridge.summary?.documentId === documentId
        ? this.bridge.summary.wordCount
        : undefined;

    void this.assistant
      .reviewPassages(
        {
          documentId,
          title: this.openDocumentTitle || "Untitled",
          passages: changedPassages.map((p) => ({
            passageId: p.passageId,
            index: p.index,
            text: p.text,
            contentHash: p.contentHash,
          })),
          ...(wordCount !== undefined ? { documentWordCount: wordCount } : {}),
        },
        controller.signal,
      )
      .then((result) => {
        if (
          controller.signal.aborted ||
          this.inFlight?.controller !== controller
        ) {
          return;
        }
        this.inFlight = null;

        if (!result.ok) {
          // ADR 0012: a failed review is silent; leave passages dirty for next
          // pause, and refresh readiness when the provider is unavailable.
          if (this.openDocumentId === documentId) {
            for (const id of passageIds) this.dirtyPassageIds.add(id);
          }
          if (result.unavailable) {
            this.onUnavailable?.();
          }
          this.emit();
          return;
        }

        if (this.openDocumentId !== documentId) {
          this.emit();
          return;
        }

        for (const p of changedPassages) {
          this.reviewedHashes.set(p.passageId, p.contentHash);
        }

        const batch: PendingReviewBatch = {
          documentId,
          passageIds,
          passagesById,
          findings: result.response.items,
        };

        if (this.typingActive) {
          // ADR 0012: hold underlines while the writer types elsewhere until
          // the next pause.
          this.heldReviews.push(batch);
          this.emit();
          return;
        }

        this.applyReviewBatch(batch);

        if (
          !this.paused &&
          !this.chatBusy &&
          !this.typingActive &&
          this.dirtyPassageIds.size > 0
        ) {
          this.startReview();
        }
      });
  }

  private applyReviewBatch(batch: PendingReviewBatch): void {
    if (batch.documentId !== this.openDocumentId) return;

    const prevActiveCount = this.findings.filter(
      (f) => f.status === "active",
    ).length;

    const dismissals = this.dismissalsByDoc.get(batch.documentId);
    if (dismissals && dismissals.size > 0) {
      // Drop any dismissal for a reviewed passage once its quoted text is gone.
      const reviewedTexts = [...batch.passagesById.values()].map((p) => p.text);
      const stillInOtherFindings = new Set(
        this.findings
          .filter((f) => !batch.passageIds.has(f.passageId))
          .map((f) => dismissalKey(f.agent, f.quote)),
      );
      for (const key of [...dismissals]) {
        const sep = key.indexOf("\0");
        const quote = sep === -1 ? key : key.slice(sep + 1);
        const matchesReviewed = reviewedTexts.some((t) => t.includes(quote));
        if (!matchesReviewed && !stillInOtherFindings.has(key)) {
          // Only prune if quote no longer exists anywhere in the open document.
          if (!this.bridge.hasExactQuote(batch.documentId, quote)) {
            dismissals.delete(key);
          }
        }
      }
    }

    const preserved = this.findings.filter(
      (f) => !batch.passageIds.has(f.passageId),
    );
    const incoming: TrackedFinding[] = [];
    const docTitle = this.openDocumentTitle || "Untitled";

    // Re-check current passage hashes before applying anchors so stale results
    // from an edited passage are never applied.
    const livePassages = new Map(
      this.bridge
        .readPassages(batch.documentId, batch.passageIds)
        .map((p) => [p.passageId, hashPassageText(p.text)] as const),
    );

    for (const item of batch.findings) {
      if (dismissals?.has(dismissalKey(item.agent, item.anchor.quote))) {
        continue;
      }
      if (livePassages.get(item.anchor.passageId) !== item.anchor.contentHash) {
        continue;
      }
      const resolved = this.bridge.resolveAnchor(batch.documentId, item.anchor);
      if (!resolved) continue;
      const passage = batch.passagesById.get(item.anchor.passageId);
      const passageWords = passage
        ? passage.text.trim().split(/\s+/).filter(Boolean).length
        : item.audit.totalWords;
      incoming.push({
        findingId: item.findingId,
        documentId: batch.documentId,
        passageId: item.anchor.passageId,
        sceneIndex: resolved.sceneIndex,
        agent: item.agent,
        agentLabel: item.agentLabel,
        category: item.category,
        confidence: item.confidence,
        note: item.note,
        quote: item.anchor.quote,
        style: underlineStyleFor(item.agent),
        status: "active",
        from: resolved.from,
        to: resolved.to,
        audit: item.audit,
        sourceSnapshot: {
          documentId: batch.documentId,
          title: docTitle,
          subtitle: `changed paragraph ${(passage?.index ?? 0) + 1} · ${formatWords(passageWords)} · as read`,
          markdown: passage?.text ?? item.anchor.quote,
        },
      });
    }

    this.findings = applyDensityCaps([...preserved, ...incoming]);
    if (
      this.selectedFindingId &&
      !this.findings.some((f) => f.findingId === this.selectedFindingId)
    ) {
      this.selectedFindingId = null;
    }

    this.syncDecorations();

    const nextActiveCount = this.findings.filter(
      (f) => f.status === "active",
    ).length;
    if (nextActiveCount !== prevActiveCount) {
      this.announce(countLabel(nextActiveCount));
    }
    this.emit();
  }

  private abortInFlight(requeuePassages: boolean): void {
    if (!this.inFlight) return;
    const { controller, passageIds, documentId } = this.inFlight;
    this.inFlight = null;
    controller.abort();
    if (requeuePassages && documentId === this.openDocumentId) {
      for (const id of passageIds) this.dirtyPassageIds.add(id);
    }
  }

  private syncDecorations(): void {
    if (!this.openDocumentId) return;
    const ranges: FindingDecorationRange[] = this.findings.map((f) => ({
      findingId: f.findingId,
      from: f.from,
      to: f.to,
      quote: f.quote,
      style: f.style,
      status: f.status,
    }));
    this.bridge.syncFindingDecorations(
      this.openDocumentId,
      ranges,
      this.selectedFindingId,
    );
  }

  private announce(text: string): void {
    this.announcement = { id: this.nextAnnouncementId++, text };
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }
}
