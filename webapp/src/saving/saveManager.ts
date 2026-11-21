import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { client, type Document, type DocumentContent } from "../api/client";
import {
  documentQueryOptions,
  read,
  workspaceQueryOptions,
} from "../api/queries";
import { makeWorkspaceChange } from "../api/workspaceChanges";
import {
  DocumentSaver,
  type CreateRequest,
  type DocumentPlace,
  type SaveStatus,
  type SaverDeps,
} from "./documentSaver";
import {
  claimTabId,
  openUnsavedTextStore,
  takeLock,
  tabLockName,
  type UnsavedRecord,
  type UnsavedTextStore,
} from "./unsavedText";

export interface SaveNotice {
  id: number;
  message: string;
}

const savedStatus: SaveStatus = { state: "saved" };

// Whether a recovered saver may still change the stored content: it is
// saving, or resolving a conflict that has not stopped on a problem.
function isBusy(status: SaveStatus): boolean {
  return (
    status.state === "saving" ||
    (status.state === "conflict" && status.problem === undefined)
  );
}

function key(documentId: string, tabId: string): string {
  return `${documentId}:${tabId}`;
}

// Every document's saver in this tab, the unsaved-text records it recovers
// at startup, and the page events that flush pending changes.
export class SaveManager {
  readonly ready: Promise<void>;
  private readonly queryClient: QueryClient;
  private readonly store: UnsavedTextStore;
  private readonly savers = new Map<string, DocumentSaver>();
  // Savers for text left by an earlier page, created at startup.
  private readonly recovering = new Set<DocumentSaver>();
  // Other tabs' locks, held until each of their records is saved.
  private readonly held = new Map<
    string,
    { release: () => void; count: number }
  >();
  private readonly listeners = new Set<() => void>();
  private readonly replacedListeners = new Set<
    (from: string, to: string) => void
  >();
  private noticeList: SaveNotice[] = [];
  private nextNotice = 1;
  private tabId = "";
  private readonly removeEvents: () => void;

  constructor(
    queryClient: QueryClient,
    store: UnsavedTextStore = openUnsavedTextStore(),
    claim: () => Promise<string> = claimTabId,
  ) {
    this.queryClient = queryClient;
    this.store = store;
    this.ready = claim().then(async (tabId) => {
      this.tabId = tabId;
      await this.recover();
    });
    this.removeEvents = this.listen();
  }

  dispose(): void {
    this.removeEvents();
    for (const saver of this.savers.values()) saver.dispose();
    this.savers.clear();
    for (const { release } of this.held.values()) release();
    this.held.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onReplaced(listener: (from: string, to: string) => void): () => void {
    this.replacedListeners.add(listener);
    return () => this.replacedListeners.delete(listener);
  }

  status(documentId: string): SaveStatus {
    return this.saverFor(documentId)?.status ?? savedStatus;
  }

  // This tab's saver for a document, or else one recovering text for it.
  private saverFor(documentId: string): DocumentSaver | undefined {
    const own = this.savers.get(key(documentId, this.tabId));
    if (own) return own;
    return [...this.recovering].find(
      (saver) => saver.documentId === documentId,
    );
  }

  // Resolves once startup recovery has saved any text left for a document,
  // or has stopped on a problem, so content read afterwards includes it.
  whenRecovered(documentId: string): Promise<void> {
    return this.ready.then(
      () =>
        new Promise<void>((resolve) => {
          let unsubscribe = () => {};
          const check = () => {
            const busy = [...this.recovering].some(
              (saver) =>
                saver.documentId === documentId && isBusy(saver.status),
            );
            if (busy) return;
            unsubscribe();
            resolve();
          };
          unsubscribe = this.subscribe(check);
          check();
        }),
    );
  }

  get notices(): SaveNotice[] {
    return this.noticeList;
  }

  dismissNotice = (id: number): void => {
    this.noticeList = this.noticeList.filter((notice) => notice.id !== id);
    this.emit();
  };

  // Opens a document whose content was read from the service after
  // whenRecovered. Returns its saver and the text the editor shows: text
  // not yet acknowledged, from this tab or recovered from an earlier page,
  // or else the content read.
  open(
    documentId: string,
    content: DocumentContent,
  ): { saver: DocumentSaver; markdown: string } {
    const existing = this.saverFor(documentId);
    if (existing && (existing.tabId === this.tabId || existing.unsettled)) {
      existing.reset(content);
      return { saver: existing, markdown: existing.text() };
    }
    const place = this.place(documentId);
    const saver = this.add({
      documentId,
      tabId: this.tabId,
      baseRevision: content.revision,
      acknowledged: content.markdown,
      pending: null,
      title: place?.title ?? "",
      parentId: place?.parentId ?? null,
    });
    return { saver, markdown: content.markdown };
  }

  // Drops this tab's unsaved text for documents the writer deleted here.
  discard(documentIds: string[]): void {
    for (const documentId of documentIds) {
      const saver = this.savers.get(key(documentId, this.tabId));
      if (!saver) continue;
      saver.discard();
      this.remove(saver);
    }
  }

  flushAll(options: { keepalive?: boolean } = {}): void {
    for (const saver of this.savers.values()) saver.flush(options);
  }

  private listen(): () => void {
    const target = globalThis as Partial<typeof globalThis>;
    if (!target.addEventListener || !target.document) return () => {};
    const onVisibility = () => {
      if (globalThis.document.visibilityState === "hidden") this.flushAll();
    };
    const onPageHide = () => this.flushAll({ keepalive: true });
    const onOnline = () => {
      for (const saver of this.savers.values()) saver.online();
    };
    globalThis.document.addEventListener("visibilitychange", onVisibility);
    globalThis.addEventListener("pagehide", onPageHide);
    globalThis.addEventListener("online", onOnline);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", onVisibility);
      globalThis.removeEventListener("pagehide", onPageHide);
      globalThis.removeEventListener("online", onOnline);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  // Saves the records left by this tab before a reload, and those of closed
  // tabs whose lock this tab can take, through the stale-write rule.
  private async recover(): Promise<void> {
    let records: UnsavedRecord[];
    try {
      records = await this.store.all();
    } catch {
      return;
    }
    const byTab = new Map<string, UnsavedRecord[]>();
    for (const record of records) {
      byTab.set(record.tabId, [...(byTab.get(record.tabId) ?? []), record]);
    }
    for (const [tabId, tabRecords] of byTab) {
      if (tabId !== this.tabId) {
        const release = await takeLock(tabLockName(tabId));
        if (!release) continue;
        this.held.set(tabId, { release, count: tabRecords.length });
      }
      for (const record of tabRecords) {
        const saver = this.add({
          documentId: record.documentId,
          tabId: record.tabId,
          baseRevision: record.baseRevision,
          acknowledged: null,
          pending: record.markdown,
          title: record.title,
          parentId: record.parentId,
        });
        this.recovering.add(saver);
        saver.flush();
      }
    }
  }

  private add(init: ConstructorParameters<typeof DocumentSaver>[0]) {
    const saver = new DocumentSaver(init, this.deps());
    this.savers.set(key(init.documentId, init.tabId), saver);
    saver.subscribe(() => this.emit());
    this.emit();
    return saver;
  }

  private remove(saver: DocumentSaver): void {
    const id = key(saver.documentId, saver.tabId);
    if (this.savers.get(id) !== saver) return;
    this.savers.delete(id);
    this.recovering.delete(saver);
    saver.dispose();
    const held = this.held.get(saver.tabId);
    if (held && --held.count === 0) {
      held.release();
      this.held.delete(saver.tabId);
    }
    this.emit();
  }

  private place(documentId: string): DocumentPlace | undefined {
    const items =
      this.queryClient.getQueryData(workspaceQueryOptions.queryKey)?.items ??
      [];
    const item = items.find((candidate) => candidate.id === documentId);
    const metadata = this.queryClient.getQueryData(
      documentQueryOptions(documentId).queryKey,
    );
    const title = item?.title ?? metadata?.title;
    if (title === undefined) return undefined;
    const parentId = item ? item.parentId : (metadata?.parentId ?? null);
    const siblings = items.filter(
      (candidate) => candidate.parentId === parentId,
    );
    const index = siblings.findIndex(
      (candidate) => candidate.id === documentId,
    );
    return {
      title,
      parentId,
      nextId: index === -1 ? null : (siblings[index + 1]?.id ?? null),
      parentExists:
        parentId === null ||
        items.some(
          (candidate) =>
            candidate.id === parentId && candidate.kind === "folder",
        ),
    };
  }

  private deps(): SaverDeps {
    const queryClient = this.queryClient;
    return {
      store: this.store,
      save: (documentId, markdown, baseRevision, keepalive) =>
        read(
          client.PUT("/api/v1/documents/{documentId}/content", {
            params: { path: { documentId } },
            body: { markdown, baseRevision },
            keepalive,
          }),
        ),
      read: (documentId) =>
        read(
          client.GET("/api/v1/documents/{documentId}/content", {
            params: { path: { documentId } },
          }),
        ),
      create: async (request: CreateRequest) => {
        const result = await makeWorkspaceChange(queryClient, {
          type: "create",
          kind: "document",
          ...request,
        });
        if (!result || !("revision" in result)) {
          throw new Error("creating a document returned no document");
        }
        return result;
      },
      place: (documentId) => this.place(documentId),
      refreshTree: async () => {
        try {
          await queryClient.fetchQuery({
            ...workspaceQueryOptions,
            staleTime: 0,
          });
        } catch {
          // The cached tree places the copy instead.
        }
      },
      saved: (document: Document) => {
        queryClient.setQueryData(
          documentQueryOptions(document.id).queryKey,
          document,
        );
      },
      notice: (message) => {
        this.noticeList = [
          ...this.noticeList,
          { id: this.nextNotice++, message },
        ];
        this.emit();
      },
      replaced: (from, to) => {
        const place = this.place(to.id);
        const saver = this.add({
          documentId: to.id,
          tabId: this.tabId,
          baseRevision: to.revision,
          acknowledged: to.sent,
          pending: to.text,
          title: place?.title ?? "",
          parentId: place?.parentId ?? null,
        });
        this.remove(from);
        if (saver.unsettled) saver.flush();
        for (const listener of this.replacedListeners) {
          listener(from.documentId, to.id);
        }
      },
      idle: (saver) => this.remove(saver),
    };
  }
}

const managers = new WeakMap<QueryClient, SaveManager>();

export function saveManagerFor(queryClient: QueryClient): SaveManager {
  let manager = managers.get(queryClient);
  if (!manager) {
    manager = new SaveManager(queryClient);
    managers.set(queryClient, manager);
  }
  return manager;
}

export function useSaveManager(): SaveManager {
  return saveManagerFor(useQueryClient());
}

export function useSaveStatus(documentId: string | undefined): SaveStatus {
  const manager = useSaveManager();
  const snapshot = useCallback(
    () => (documentId ? manager.status(documentId) : savedStatus),
    [manager, documentId],
  );
  return useSyncExternalStore(manager.subscribe, snapshot);
}

export function useSaveNotices(): {
  notices: SaveNotice[];
  dismiss: (id: number) => void;
} {
  const manager = useSaveManager();
  const notices = useSyncExternalStore(
    manager.subscribe,
    () => manager.notices,
  );
  return { notices, dismiss: manager.dismissNotice };
}
