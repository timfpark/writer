import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document, DocumentContent, Problem } from "../api/client";
import { ServiceError } from "../api/queries";
import {
  copyTitle,
  DocumentSaver,
  type CreateRequest,
  type SaverDeps,
} from "./documentSaver";
import { memoryStore } from "./unsavedText";

const documentId = "0b7c3f1e-5d2a-4c8e-9f6b-1a3d5e7f9b2c";
const tabId = "tab-one";

function problem(status: number, code: Problem["code"]): ServiceError {
  return new ServiceError(
    { type: "about:blank", code, status, title: "", detail: "", errors: [] },
    status,
  );
}

// A synthetic service holding one document's content and revisions.
function harness(initial = "Rain on the harbor.\n", language = "en") {
  let stored = initial;
  let revision = 1;
  const responses: (Error | null)[] = [];
  const createFailures: Error[] = [];
  const saves: { markdown: string; base: string }[] = [];
  const creates: CreateRequest[] = [];
  const notices: string[] = [];
  const replaced: string[] = [];
  const store = memoryStore();
  const deps: SaverDeps = {
    store,
    save(_id, markdown, base) {
      saves.push({ markdown, base });
      const failure = responses.shift();
      if (failure) return Promise.reject(failure);
      if (markdown !== stored && base !== `r${revision}`) {
        return Promise.reject(problem(409, "conflict"));
      }
      if (markdown !== stored) {
        stored = markdown;
        revision += 1;
      }
      const document: Document = {
        id: documentId,
        parentId: null,
        title: "Harbor",
        language,
        revision: `r${revision}`,
      };
      return Promise.resolve(document);
    },
    read() {
      const content: DocumentContent = {
        markdown: stored,
        revision: `r${revision}`,
      };
      return Promise.resolve(content);
    },
    create(request) {
      creates.push(request);
      const failure = createFailures.shift();
      if (failure) return Promise.reject(failure);
      return Promise.resolve({
        id: request.id,
        parentId: request.parentId,
        title: request.title,
        language: request.language ?? "en",
        revision: "copy",
      });
    },
    place: () => ({
      title: "Harbor",
      parentId: "folder",
      language,
      nextId: "next",
      parentExists: true,
    }),
    refreshTree: () => Promise.resolve(),
    saved: () => {},
    notice: (message) => notices.push(message),
    replaced: (_from, to) => replaced.push(to.text),
    idle: () => {},
  };
  let text = initial;
  const saver = new DocumentSaver(
    {
      documentId,
      tabId,
      baseRevision: "r1",
      acknowledged: initial,
      pending: null,
      title: "Harbor",
      parentId: "folder",
      language,
    },
    deps,
  );
  saver.attach(() => text);
  return {
    saver,
    store,
    saves,
    creates,
    notices,
    replaced,
    responses,
    createFailures,
    type(next: string) {
      text = next;
      saver.change();
    },
    editOutside(next: string) {
      stored = next;
      revision += 1;
    },
    get stored() {
      return stored;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocumentSaver", () => {
  it("saves one second after the last change", async () => {
    const h = harness();
    h.type("Rain on the harbor. Gulls\n");
    expect(h.saver.status.state).toBe("saving");
    await vi.advanceTimersByTimeAsync(900);
    h.type("Rain on the harbor. Gulls rose.\n");
    await vi.advanceTimersByTimeAsync(900);
    expect(h.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.saves).toEqual([
      { markdown: "Rain on the harbor. Gulls rose.\n", base: "r1" },
    ]);
    expect(h.saver.status.state).toBe("saved");
    expect(await h.store.all()).toEqual([]);
  });

  it("saves within five seconds while typing continues", async () => {
    const h = harness();
    for (let tick = 0; tick < 12; tick++) {
      h.type(`Rain${"!".repeat(tick)}\n`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(h.saves.length).toBe(1);
  });

  it("writes the unsaved-text record while typing", async () => {
    const h = harness();
    h.type("Lanterns along the quay.\n");
    await vi.advanceTimersByTimeAsync(500);
    const [record] = await h.store.all();
    expect(record).toMatchObject({
      documentId,
      tabId,
      baseRevision: "r1",
      markdown: "Lanterns along the quay.\n",
      title: "Harbor",
      parentId: "folder",
    });
  });

  it("never saves text that has not changed", async () => {
    const h = harness();
    h.type("Something else\n");
    h.type("Rain on the harbor.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.saves).toEqual([]);
    expect(h.saver.status.state).toBe("saved");
  });

  it("keeps one save in flight and sends later changes next", async () => {
    const h = harness();
    h.type("First draft\n");
    h.saver.flush();
    h.type("Second draft\n");
    h.saver.flush();
    expect(h.saves).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.saves.map((save) => save.markdown)).toEqual([
      "First draft\n",
      "Second draft\n",
    ]);
    expect(h.saves[1]?.base).toBe("r2");
  });

  it("retries an unreachable service with backoff", async () => {
    const h = harness();
    h.responses.push(new ServiceError(), problem(503, "unavailable"));
    h.type("Fog over the breakwater.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.saver.status.state).toBe("retrying");
    // Typing does not bypass the backoff.
    h.type("Fog over the breakwater, thick.\n");
    await vi.advanceTimersByTimeAsync(999);
    expect(h.saves).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saves).toHaveLength(2);
    expect(h.saver.status.state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.saves).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saves).toHaveLength(3);
    expect(h.saver.status.state).toBe("saved");
    expect(h.stored).toBe("Fog over the breakwater, thick.\n");
    expect(h.saves.every((save) => save.base === "r1")).toBe(true);
  });

  it("keeps both versions after a conflict", async () => {
    const h = harness("Lluvia sobre el puerto.\n", "es");
    h.editOutside("Escrito en otro editor.\n");
    h.type("Escrito en Writer.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.creates).toEqual([
      expect.objectContaining({
        parentId: "folder",
        beforeId: "next",
        title: "Harbor (saved elsewhere)",
        markdown: "Escrito en otro editor.\n",
        language: "es",
      }),
    ]);
    expect(h.stored).toBe("Escrito en Writer.\n");
    expect(h.saver.status.state).toBe("saved");
    expect(h.notices).toHaveLength(1);
  });

  it("adopts the stored revision when it holds the same text", async () => {
    const h = harness();
    h.editOutside("Same words.\n");
    h.type("Same words.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.creates).toEqual([]);
    expect(h.saver.status.state).toBe("saved");
    expect(h.saver.baseRevision).toBe("r2");
  });

  it("stops at a copy it cannot create and resumes on a flush", async () => {
    const h = harness();
    h.createFailures.push(problem(422, "validationFailed"));
    h.editOutside("Elsewhere.\n");
    h.type("Here.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.saver.status.state).toBe("conflict");
    expect(h.saver.status.problem).toBeInstanceOf(ServiceError);
    expect(h.stored).toBe("Elsewhere.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.stored).toBe("Here.\n");
    expect(h.saver.status.state).toBe("saved");
  });

  it("recreates a document deleted elsewhere", async () => {
    const h = harness("Lluvia sobre el puerto.\n", "es");
    h.responses.push(problem(404, "notFound"));
    h.type("Conservado tras borrar.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.creates).toEqual([
      expect.objectContaining({
        parentId: "folder",
        title: "Harbor",
        markdown: "Conservado tras borrar.\n",
        language: "es",
      }),
    ]);
    expect(h.replaced).toEqual(["Conservado tras borrar.\n"]);
  });

  it("does not retry rejected content until it changes", async () => {
    const h = harness();
    h.responses.push(problem(413, "payloadTooLarge"));
    h.type("Too long.\n");
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.saves).toHaveLength(1);
    expect(h.saver.status.state).toBe("failed");
    h.type("Shorter.\n");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.saves).toHaveLength(2);
    expect(h.saver.status.state).toBe("saved");
  });
});

describe("copyTitle", () => {
  it("marks the copy and stays within 200 characters", () => {
    expect(copyTitle("Harbor")).toBe("Harbor (saved elsewhere)");
    const long = copyTitle("é".repeat(200));
    expect(Array.from(long).length).toBe(200);
    expect(long.endsWith(" (saved elsewhere)")).toBe(true);
  });
});
