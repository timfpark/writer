import type { Document, DocumentContent } from "../api/client";
import { ServiceError } from "../api/queries";
import type { UnsavedTextStore } from "./unsavedText";

// ADR 0008's autosave timing.
export const idleDelay = 1_000;
export const maxDelay = 5_000;
export const recordInterval = 500;
export const firstRetryDelay = 1_000;
export const lastRetryDelay = 30_000;
// The most a page may send with keepalive after it unloads.
export const keepaliveLimit = 64 * 1024;

export type SaveState = "saved" | "saving" | "retrying" | "conflict" | "failed";

export interface SaveStatus {
  state: SaveState;
  // Why saving stopped, for the conflict and failed states.
  problem?: unknown;
}

// Where a document sits, for its unsaved-text record and for placing a
// conflict copy or a recreated document.
export interface DocumentPlace {
  title: string;
  parentId: string | null;
  // The sibling after it, or null when it is last.
  nextId: string | null;
  // Whether the parent folder still exists.
  parentExists: boolean;
}

export interface CreateRequest {
  id: string;
  parentId: string | null;
  beforeId: string | null;
  title: string;
  markdown: string;
}

export interface SaverDeps {
  store: UnsavedTextStore;
  save(
    documentId: string,
    markdown: string,
    baseRevision: string,
    keepalive: boolean,
  ): Promise<Document>;
  read(documentId: string): Promise<DocumentContent>;
  create(request: CreateRequest): Promise<Document>;
  place(documentId: string): DocumentPlace | undefined;
  // Rereads the tree, so a copy is placed by the latest order.
  refreshTree(): Promise<void>;
  saved(document: Document): void;
  notice(message: string): void;
  // The document was deleted elsewhere and its text now lives in a new one.
  replaced(
    from: DocumentSaver,
    to: { id: string; revision: string; sent: string; text: string },
  ): void;
  // The saver holds nothing unacknowledged and no editor is attached.
  idle(saver: DocumentSaver): void;
}

export interface SaverInit {
  documentId: string;
  // The tab whose unsaved-text record this saver keeps.
  tabId: string;
  baseRevision: string;
  // The text baseRevision holds, or null when unknown, as for a record left
  // by an earlier page.
  acknowledged: string | null;
  // Text not yet acknowledged, or null when there is none.
  pending: string | null;
  title: string;
  parentId: string | null;
}

const copySuffix = " (saved elsewhere)";
const titleLimit = 200;

// The conflict copy's title: the original's, marked as the version saved
// elsewhere, within ADR 0005's 200 characters.
export function copyTitle(title: string): string {
  const room = titleLimit - Array.from(copySuffix).length;
  const scalars = Array.from(title);
  const base =
    scalars.length > room ? scalars.slice(0, room).join("").trimEnd() : title;
  return `${base}${copySuffix}`;
}

function isUnreachable(error: unknown): boolean {
  if (!(error instanceof ServiceError)) return true;
  return error.httpStatus === undefined || error.httpStatus >= 500;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

type Timer = ReturnType<typeof setTimeout>;

// ADR 0007's per-document save controller. It keeps one save in flight,
// saves on ADR 0008's timing and flush events, holds unacknowledged text in
// the unsaved-text record, retries an unreachable service, and recovers
// from conflicts and deletions as ADR 0005 describes, never discarding the
// writer's text.
export class DocumentSaver {
  readonly documentId: string;
  readonly tabId: string;
  private readonly deps: SaverDeps;
  private base: string;
  private acknowledged: string | null;
  private pending: string | null;
  private title: string;
  private parentId: string | null;
  private source: (() => string) | null = null;
  private dirty = false;
  private inFlight = false;
  private due = false;
  private phase: "idle" | "retrying" | "conflict" | "failed" | "replaced" =
    "idle";
  private problem: unknown = undefined;
  private recovering = false;
  private discarded = false;
  private copyId: string | null = null;
  private replacementId: string | null = null;
  private retryDelay = firstRetryDelay;
  private idleTimer: Timer | undefined;
  private maxTimer: Timer | undefined;
  private recordTimer: Timer | undefined;
  private retryTimer: Timer | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot: SaveStatus = { state: "saved" };

  constructor(init: SaverInit, deps: SaverDeps) {
    this.documentId = init.documentId;
    this.tabId = init.tabId;
    this.base = init.baseRevision;
    this.acknowledged = init.acknowledged;
    this.pending =
      init.pending === init.acknowledged ? null : (init.pending ?? null);
    this.title = init.title;
    this.parentId = init.parentId;
    this.deps = deps;
    this.update();
  }

  get status(): SaveStatus {
    return this.snapshot;
  }

  get baseRevision(): string {
    return this.base;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Whether the saver holds text the service has not acknowledged, or is
  // still resolving a problem.
  get unsettled(): boolean {
    return (
      this.dirty ||
      this.pending !== null ||
      this.inFlight ||
      this.recovering ||
      this.phase !== "idle"
    );
  }

  // Starts from content just read from the service, when nothing is
  // unsettled.
  reset(content: DocumentContent): void {
    if (this.unsettled) return;
    this.base = content.revision;
    this.acknowledged = content.markdown;
    this.pending = null;
    this.update();
  }

  // An editor attaches the function that serializes its document.
  attach(source: () => string): void {
    this.source = source;
  }

  detach(): void {
    this.flush();
    this.text();
    this.source = null;
    this.settleIfIdle();
  }

  // The writer's current text.
  text(): string {
    if (this.dirty && this.source) {
      this.dirty = false;
      const text = this.source();
      this.pending = text === this.acknowledged ? null : text;
    }
    return this.pending ?? this.acknowledged ?? "";
  }

  // The editor's document changed.
  change(): void {
    if (this.discarded) return;
    this.dirty = true;
    if (this.phase === "failed") {
      // A rejected save is not retried until the content changes.
      this.phase = "idle";
      this.problem = undefined;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.timeCome(), idleDelay);
    this.maxTimer ??= setTimeout(() => this.timeCome(), maxDelay);
    this.recordTimer ??= setTimeout(() => {
      this.recordTimer = undefined;
      this.writeRecord();
    }, recordInterval);
    this.update();
  }

  // Writes the unsaved-text record at once and saves now, or directly after
  // the save in flight. On pagehide a small save is sent with keepalive.
  flush(options: { keepalive?: boolean } = {}): void {
    if (this.discarded) return;
    this.writeRecord();
    if (this.phase === "conflict") {
      if (!this.recovering) void this.recover();
      return;
    }
    if (this.phase === "retrying") this.retryDelay = firstRetryDelay;
    this.timeCome(options.keepalive === true, true);
  }

  // The browser came back online.
  online(): void {
    if (
      this.phase === "retrying" ||
      (this.phase === "conflict" && !this.recovering)
    ) {
      this.flush();
    }
  }

  // The writer deleted the document in this tab: its text goes with it.
  discard(): void {
    this.discarded = true;
    this.dispose();
    void this.deps.store.delete(this.documentId, this.tabId);
  }

  dispose(): void {
    for (const timer of [
      this.idleTimer,
      this.maxTimer,
      this.recordTimer,
      this.retryTimer,
    ]) {
      clearTimeout(timer);
    }
    this.listeners.clear();
  }

  // A save's time has come. While the service is unreachable, only a flush
  // or the retry timer sends, so typing does not bypass the backoff.
  private timeCome(keepalive = false, force = false): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.idleTimer = undefined;
    this.maxTimer = undefined;
    if (this.inFlight || this.recovering) {
      this.due = true;
      return;
    }
    if (this.phase === "retrying" && !force) return;
    if (this.phase !== "idle" && this.phase !== "retrying") return;
    void this.send(keepalive);
  }

  private writeRecord(): void {
    clearTimeout(this.recordTimer);
    this.recordTimer = undefined;
    if (this.discarded) return;
    const markdown = this.text();
    if (this.pending === null) return;
    void this.deps.store.put({
      documentId: this.documentId,
      tabId: this.tabId,
      baseRevision: this.base,
      markdown,
      title: this.title,
      parentId: this.parentId,
      updatedAt: Date.now(),
    });
  }

  private refreshPlace(): DocumentPlace | undefined {
    const place = this.deps.place(this.documentId);
    if (place) {
      this.title = place.title;
      this.parentId = place.parentId;
    }
    return place;
  }

  private async send(keepalive: boolean): Promise<void> {
    if (this.discarded) return;
    const markdown = this.text();
    if (this.pending === null) {
      if (this.phase === "retrying") this.phase = "idle";
      this.update();
      this.settleIfIdle();
      return;
    }
    if (keepalive && utf8Length(markdown) > keepaliveLimit) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.refreshPlace();
    this.writeRecord();
    this.inFlight = true;
    this.update();
    let document: Document;
    try {
      document = await this.deps.save(
        this.documentId,
        markdown,
        this.base,
        keepalive,
      );
    } catch (error) {
      this.inFlight = false;
      this.failed(error);
      return;
    }
    this.inFlight = false;
    this.acknowledge(markdown, document.revision);
    this.deps.saved(document);
    this.afterSettled();
  }

  private acknowledge(markdown: string, revision: string): void {
    this.base = revision;
    this.acknowledged = markdown;
    if (this.pending === markdown) this.pending = null;
    this.phase = "idle";
    this.problem = undefined;
    this.retryDelay = firstRetryDelay;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    void this.deps.store.acknowledge(
      this.documentId,
      this.tabId,
      markdown,
      revision,
    );
    this.update();
  }

  private afterSettled(): void {
    if (this.due) {
      this.due = false;
      this.timeCome();
      return;
    }
    this.update();
    this.settleIfIdle();
  }

  private failed(error: unknown): void {
    if (this.discarded) return;
    if (isUnreachable(error)) {
      this.retryLater(() => this.timeCome(false, true));
      this.phase = "retrying";
      this.update();
      return;
    }
    const status = error instanceof ServiceError ? error.httpStatus : undefined;
    if (status === 409) {
      this.phase = "conflict";
      this.update();
      void this.recover();
      return;
    }
    if (status === 404) {
      void this.recreate();
      return;
    }
    // 413, 422, and anything else: keep the text and wait for a change.
    this.phase = "failed";
    this.problem = error;
    this.due = false;
    this.update();
  }

  private retryLater(retry: () => void): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      retry();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, lastRetryDelay);
  }

  // ADR 0005's conflict recovery, from step 2.
  private async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.phase = "conflict";
    this.update();
    try {
      for (;;) {
        let stored: DocumentContent;
        try {
          stored = await this.deps.read(this.documentId);
        } catch (error) {
          if (error instanceof ServiceError && error.httpStatus === 404) {
            this.recovering = false;
            void this.recreate();
            return;
          }
          this.waitToRecover(error);
          return;
        }
        if (stored.markdown === this.text()) {
          this.acknowledge(stored.markdown, stored.revision);
          this.copyId = null;
          break;
        }
        await this.deps.refreshTree();
        const place = this.refreshPlace();
        const copy = {
          id: (this.copyId ??= crypto.randomUUID()),
          parentId: place?.parentId ?? this.parentId,
          beforeId: place?.nextId ?? null,
          title: copyTitle(place?.title ?? this.title),
          markdown: stored.markdown,
        };
        try {
          await this.deps.create(copy);
        } catch (error) {
          this.waitToRecover(error);
          return;
        }
        this.copyId = null;
        const markdown = this.text();
        try {
          const document = await this.deps.save(
            this.documentId,
            markdown,
            stored.revision,
            false,
          );
          this.acknowledge(markdown, document.revision);
          this.deps.saved(document);
        } catch (error) {
          if (error instanceof ServiceError && error.httpStatus === 409) {
            this.notice(copy.title);
            continue;
          }
          this.base = stored.revision;
          this.notice(copy.title);
          this.recovering = false;
          this.failed(error);
          return;
        }
        this.notice(copy.title);
        break;
      }
    } finally {
      this.recovering = false;
    }
    this.afterSettled();
  }

  private notice(copy: string): void {
    this.deps.notice(
      `“${this.title}” changed outside this tab, so Writer kept that version as “${copy}” beside it and saved your text here.`,
    );
  }

  // Recovery stopped on a problem, such as an unreachable service or a full
  // workspace. It resumes from step 2 after a delay or on the next flush.
  private waitToRecover(error: unknown): void {
    this.phase = "conflict";
    this.problem = isUnreachable(error) ? undefined : error;
    this.recovering = false;
    this.retryLater(() => void this.recover());
    this.update();
  }

  // The document was deleted elsewhere: the text goes into a new document
  // with the same title, in the same folder if it still exists.
  private async recreate(): Promise<void> {
    const place = this.refreshPlace();
    const parentId = place
      ? place.parentExists
        ? place.parentId
        : null
      : this.parentId;
    const id = (this.replacementId ??= crypto.randomUUID());
    const sent = this.text();
    this.recovering = true;
    this.phase = "replaced";
    this.update();
    let document: Document;
    try {
      document = await this.deps.create({
        id,
        parentId,
        beforeId: null,
        title: this.title,
        markdown: sent,
      });
    } catch (error) {
      this.recovering = false;
      this.phase = isUnreachable(error) ? "retrying" : "failed";
      this.problem = isUnreachable(error) ? undefined : error;
      this.retryLater(() => void this.recreate());
      this.update();
      return;
    }
    this.recovering = false;
    void this.deps.store.delete(this.documentId, this.tabId);
    this.deps.notice(
      `“${this.title}” was deleted elsewhere, so Writer saved your text as a new document with the same title.`,
    );
    this.deps.replaced(this, {
      id: document.id,
      revision: document.revision,
      sent,
      text: this.text(),
    });
    this.dispose();
  }

  private settleIfIdle(): void {
    if (!this.source && !this.unsettled) this.deps.idle(this);
  }

  private update(): void {
    let state: SaveState;
    if (this.phase === "conflict") state = "conflict";
    else if (this.phase === "retrying") state = "retrying";
    else if (this.phase === "failed") state = "failed";
    else if (this.dirty || this.pending !== null || this.inFlight)
      state = "saving";
    else state = "saved";
    const problem = this.problem;
    if (state !== this.snapshot.state || problem !== this.snapshot.problem) {
      this.snapshot = problem === undefined ? { state } : { state, problem };
      for (const listener of this.listeners) listener();
    }
  }
}
