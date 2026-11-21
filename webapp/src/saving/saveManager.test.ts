import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveManager } from "./saveManager";
import { memoryStore } from "./unsavedText";

const documentId = "4d2a6c8e-1b3f-4e5a-9c7d-0f2e4a6b8c1d";
const recovered = "Lanterns along the quay, written before the tab closed.\n";
const managers: SaveManager[] = [];

// A manager starting in a new tab, with a record a closed tab left behind.
async function start(respond: (request: Request) => Promise<Response>) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(respond);
  vi.stubGlobal("fetch", fetch);
  const store = memoryStore();
  await store.put({
    documentId,
    tabId: "closed-tab",
    baseRevision: "r0",
    markdown: recovered,
    title: "Quay",
    parentId: null,
    updatedAt: 0,
  });
  const manager = new SaveManager(new QueryClient(), store, () =>
    Promise.resolve("new-tab"),
  );
  managers.push(manager);
  return { manager, store, fetch };
}

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
});

describe("SaveManager recovery", () => {
  it("saves a closed tab's text before the document's content is read", async () => {
    const { manager, store, fetch } = await start(() =>
      Promise.resolve(
        Response.json({
          id: documentId,
          parentId: null,
          title: "Quay",
          revision: "r1",
        }),
      ),
    );

    await manager.whenRecovered(documentId);

    const [request] = fetch.mock.calls[0] ?? [];
    expect(request?.method).toBe("PUT");
    expect(await request?.json()).toEqual({
      markdown: recovered,
      baseRevision: "r0",
    });
    await vi.waitFor(async () => {
      expect(await store.all()).toEqual([]);
    });
  });

  it("opens text it cannot save yet in place of the stored content", async () => {
    const { manager } = await start(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    await manager.whenRecovered(documentId);
    expect(manager.status(documentId).state).toBe("retrying");

    const { saver, markdown } = manager.open(documentId, {
      markdown: "Older text.\n",
      revision: "r0",
    });
    expect(markdown).toBe(recovered);
    expect(saver.tabId).toBe("closed-tab");
  });
});
