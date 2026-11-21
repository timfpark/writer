import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// ADR 0007's record of a document's unacknowledged text, one per document
// per tab, kept in the IndexedDB database "writer".
export interface UnsavedRecord {
  documentId: string;
  tabId: string;
  baseRevision: string;
  markdown: string;
  title: string;
  parentId: string | null;
  updatedAt: number;
}

interface WriterDB extends DBSchema {
  unsavedText: {
    key: [string, string];
    value: UnsavedRecord;
  };
}

export interface UnsavedTextStore {
  put(record: UnsavedRecord): Promise<void>;
  all(): Promise<UnsavedRecord[]>;
  delete(documentId: string, tabId: string): Promise<void>;
  // Deletes the record if it holds exactly the acknowledged text, and
  // otherwise rebases it on the acknowledged revision.
  acknowledge(
    documentId: string,
    tabId: string,
    markdown: string,
    revision: string,
  ): Promise<void>;
}

function idbStore(db: Promise<IDBPDatabase<WriterDB>>): UnsavedTextStore {
  return {
    async put(record) {
      await (await db).put("unsavedText", record);
    },
    async all() {
      return (await db).getAll("unsavedText");
    },
    async delete(documentId, tabId) {
      await (await db).delete("unsavedText", [documentId, tabId]);
    },
    async acknowledge(documentId, tabId, markdown, revision) {
      const tx = (await db).transaction("unsavedText", "readwrite");
      const record = await tx.store.get([documentId, tabId]);
      if (record?.markdown === markdown) {
        await tx.store.delete([documentId, tabId]);
      } else if (record) {
        await tx.store.put({ ...record, baseRevision: revision });
      }
      await tx.done;
    },
  };
}

// For browsers without IndexedDB, such as jsdom in tests, and those that
// refuse it: the text lasts only as long as the page.
export function memoryStore(): UnsavedTextStore {
  const records = new Map<string, UnsavedRecord>();
  const key = (documentId: string, tabId: string) => `${documentId}:${tabId}`;
  return {
    put(record) {
      records.set(key(record.documentId, record.tabId), { ...record });
      return Promise.resolve();
    },
    all() {
      return Promise.resolve([...records.values()]);
    },
    delete(documentId, tabId) {
      records.delete(key(documentId, tabId));
      return Promise.resolve();
    },
    acknowledge(documentId, tabId, markdown, revision) {
      const record = records.get(key(documentId, tabId));
      if (record?.markdown === markdown) {
        records.delete(key(documentId, tabId));
      } else if (record) {
        records.set(key(documentId, tabId), {
          ...record,
          baseRevision: revision,
        });
      }
      return Promise.resolve();
    },
  };
}

export function openUnsavedTextStore(): UnsavedTextStore {
  if (typeof indexedDB === "undefined") return memoryStore();
  const fallback = memoryStore();
  let store: UnsavedTextStore = fallback;
  const ready = openDB<WriterDB>("writer", 1, {
    upgrade(database) {
      database.createObjectStore("unsavedText", {
        keyPath: ["documentId", "tabId"],
      });
    },
  }).then(
    (db) => {
      store = idbStore(Promise.resolve(db));
    },
    () => {},
  );
  return {
    put: (record) => ready.then(() => store.put(record)),
    all: () => ready.then(() => store.all()),
    delete: (documentId, tabId) =>
      ready.then(() => store.delete(documentId, tabId)),
    acknowledge: (documentId, tabId, markdown, revision) =>
      ready.then(() =>
        store.acknowledge(documentId, tabId, markdown, revision),
      ),
  };
}

export function tabLockName(tabId: string): string {
  return `writer-tab:${tabId}`;
}

// Takes a Web Lock, and holds it until the returned release function is
// called. Resolves to null when someone holds it, at once or, given a wait,
// after waiting that many milliseconds for it.
export function takeLock(name: string, wait = 0): Promise<(() => void) | null> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(() => {});
  const options: LockOptions =
    wait > 0 ? { signal: AbortSignal.timeout(wait) } : { ifAvailable: true };
  return new Promise((resolve) => {
    locks
      .request(name, options, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(() => resolve(null));
  });
}

const tabKey = "writer.tabId";

// This tab's identifier: a UUID kept in sessionStorage, so it survives a
// reload, held under the Web Lock writer-tab:{tabId} while the tab is open.
// A reload waits briefly for the page it replaces to release the lock. A
// duplicated tab inherits the identifier, finds the lock still held, and
// takes a new one.
const reloadWait = 1_000;

export async function claimTabId(): Promise<string> {
  let stored: string | null = null;
  try {
    stored = globalThis.sessionStorage.getItem(tabKey);
  } catch {
    // Without sessionStorage each page load is a new tab.
  }
  if (stored && (await takeLock(tabLockName(stored), reloadWait))) {
    return stored;
  }
  for (;;) {
    const id = crypto.randomUUID();
    if (await takeLock(tabLockName(id))) {
      try {
        globalThis.sessionStorage.setItem(tabKey, id);
      } catch {
        // As above.
      }
      return id;
    }
  }
}
