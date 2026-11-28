import { createMemoryHistory } from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./api/queries";
import { App } from "./App";
import { createAppRouter } from "./router";

const documentId = "0b6f3c9e-5d1a-4c2b-9e7f-1a2b3c4d5e6f";

function sseResponse(
  events: Array<{ event: string; data: unknown }>,
): Response {
  const payload = events
    .map(
      ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const clients: ReturnType<typeof createQueryClient>[] = [];

function stubFetch(respond: (request: Request) => Promise<Response>) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(respond);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function problem(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Synthetic",
      status,
      detail,
      code,
      errors: [],
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

// Answers like a healthy service holding one synthetic document.
function healthyService(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/v1/health") {
    return Promise.resolve(Response.json({ status: "ok" }));
  }
  if (path === "/api/v1/workspace") {
    return Promise.resolve(
      Response.json({
        items: [
          {
            id: documentId,
            kind: "document",
            parentId: null,
            title: "Synthetic Chapter One",
            language: "en",
          },
        ],
      }),
    );
  }
  if (path === `/api/v1/documents/${documentId}`) {
    return Promise.resolve(
      Response.json({
        id: documentId,
        parentId: null,
        title: "Synthetic Chapter One",
        language: "en",
        revision: "r1",
      }),
    );
  }
  if (path === `/api/v1/documents/${documentId}/content`) {
    return Promise.resolve(
      Response.json({
        markdown: "The lamp burned *low* through the night.\n",
        revision: "r1",
      }),
    );
  }
  if (path === "/api/v1/pair-writer") {
    return Promise.resolve(
      Response.json({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
    );
  }
  if (path === "/api/v1/pair-writer/replies" && request.method === "POST") {
    return Promise.resolve(
      sseResponse([
        {
          event: "delta",
          data: {
            text: '1. In "The lamp burned low through the night.", consider *trimming one beat*.',
          },
        },
        {
          event: "done",
          data: {
            model: "scripted-pair-writer",
            promptVersion: null,
            sources: [
              {
                kind: "document",
                documentId,
                title: "Synthetic Chapter One",
                scope: "whole",
                wordCount: 7,
                label: "Synthetic Chapter One · whole · 7 words",
              },
            ],
            totalWords: 7,
            droppedHistoryTurns: 0,
            metrics: null,
          },
        },
      ]),
    );
  }
  return Promise.resolve(problem(404, "notFound", "No such item."));
}

// Makes every media query match, or none, so panes dock or overlay.
function stubViewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderApp(path = "/", queries: { retryDelay?: number } = {}) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, ...queries },
  });
  clients.push(queryClient);
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: [path] }),
  );
  return render(<App queryClient={queryClient} router={router} />);
}

function toggle(name: "Navigator" | "Assistant") {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  // The router resets scroll on navigation and ProseMirror measures Ranges on
  // selectionchange, neither of which jsdom implements.
  vi.stubGlobal("scrollTo", () => {});
  if (
    typeof Range !== "undefined" &&
    typeof Range.prototype.getClientRects !== "function"
  ) {
    Range.prototype.getClientRects = () =>
      document.createElement("div").getClientRects();
    Range.prototype.getBoundingClientRect = () =>
      document.createElement("div").getBoundingClientRect();
  }
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  localStorage.clear();
});

describe("workspace shell", () => {
  it("shows the header, both docked panes, and the writing region", async () => {
    stubFetch(healthyService);
    renderApp();

    expect(await screen.findByText("No document is open")).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Navigator" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Assistant" }),
    ).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Writer",
    );
  });

  it("gives every header control an accessible name and a tab stop", async () => {
    stubFetch(healthyService);
    renderApp();

    const header = await screen.findByRole("banner");
    const buttons = within(header).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Navigator",
      "Keyboard shortcuts",
      "Assistant",
      "Profile",
    ]);
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it("collapses both panes from the header and remembers it across reloads", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    fireEvent.click(toggle("Navigator"));
    fireEvent.click(toggle("Assistant"));

    expect(screen.queryByRole("navigation", { name: "Navigator" })).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Assistant" }),
    ).toBeNull();
    expect(toggle("Navigator").getAttribute("aria-pressed")).toBe("false");
    expect(toggle("Assistant").getAttribute("aria-pressed")).toBe("false");

    cleanup();
    renderApp();
    await screen.findByText("No document is open");

    expect(screen.queryByRole("navigation", { name: "Navigator" })).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Assistant" }),
    ).toBeNull();

    fireEvent.click(toggle("Navigator"));
    expect(screen.getByRole("navigation", { name: "Navigator" })).toBeTruthy();
  });

  it("toggles each pane with its keyboard shortcut", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    fireEvent.keyDown(window, { code: "Backslash", key: "\\", ctrlKey: true });
    expect(screen.queryByRole("navigation", { name: "Navigator" })).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Assistant" }),
    ).toBeTruthy();

    fireEvent.keyDown(window, {
      code: "Backslash",
      key: "|",
      metaKey: true,
      shiftKey: true,
    });
    expect(
      screen.queryByRole("complementary", { name: "Assistant" }),
    ).toBeNull();
    expect(localStorage.getItem("writer.navigator.collapsed")).toBe("true");
    expect(localStorage.getItem("writer.assistant.collapsed")).toBe("true");
  });

  it("opens a pane over the writing region on a narrow viewport and closes it with Escape", async () => {
    stubViewport(false);
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    expect(screen.queryByRole("navigation", { name: "Navigator" })).toBeNull();

    fireEvent.click(toggle("Navigator"));
    const dialog = await screen.findByRole("dialog", { name: "Navigator" });
    expect(within(dialog).getByRole("navigation")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Navigator" })).toBeNull();
    });
    expect(localStorage.getItem("writer.navigator.collapsed")).toBeNull();
  });

  it("requests nothing outside its own origin", async () => {
    const fetch = stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("heading", { name: "Synthetic Chapter One" });

    expect(fetch).toHaveBeenCalled();
    for (const [request] of fetch.mock.calls) {
      expect(new URL(request.url).origin).toBe(window.location.origin);
    }
  });
});

describe("routes", () => {
  it("shows an open document's title in the header", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "Writer",
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Synthetic Chapter One",
      );
    });
  });

  it("explains that a document no longer exists", async () => {
    stubFetch(healthyService);
    renderApp("/documents/9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5");

    expect(
      await screen.findByText("This document does not exist"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Go to the workspace" }),
    ).toBeTruthy();
  });

  it("never requests a document whose identifier is not a UUID", async () => {
    const fetch = stubFetch(healthyService);
    renderApp("/documents/not-an-id");

    expect(
      await screen.findByText("This document does not exist"),
    ).toBeTruthy();
    const paths = fetch.mock.calls.map(
      ([request]) => new URL(request.url).pathname,
    );
    expect(
      paths.filter((path) => path.startsWith("/api/v1/documents")),
    ).toEqual([]);
  });

  it("shows a not-found message for any other path", async () => {
    stubFetch(healthyService);
    renderApp("/elsewhere");

    expect(await screen.findByText("This page does not exist")).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
  });
});

describe("writing", () => {
  it("opens the document's text in the writing surface", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);

    const surface = await screen.findByRole("textbox", {
      name: "Synthetic Chapter One",
    });
    await waitFor(() => {
      expect(surface.textContent).toBe(
        "The lamp burned low through the night.",
      );
    });
    expect(within(surface).getByText("low").tagName).toBe("EM");
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("renames the open document from the header", async () => {
    let title = "Synthetic Chapter One";
    const fetch = stubFetch(async (request) => {
      const path = new URL(request.url).pathname;
      if (
        request.method === "PUT" &&
        path === `/api/v1/documents/${documentId}/title`
      ) {
        const body: unknown = await request.clone().json();
        if (typeof body === "object" && body && "title" in body) {
          title = String(body.title);
        }
        return Response.json({
          id: documentId,
          parentId: null,
          title,
          language: "en",
          revision: "r1",
        });
      }
      if (path === "/api/v1/workspace") {
        return Response.json({
          items: [
            {
              id: documentId,
              kind: "document",
              parentId: null,
              title,
              language: "en",
            },
          ],
        });
      }
      return healthyService(request);
    });
    renderApp(`/documents/${documentId}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Synthetic Chapter One" }),
    );
    const field = screen.getByRole("textbox", { name: "Document title" });
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    fireEvent.change(field, { target: { value: "  Synthetic Chapter Two " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Synthetic Chapter Two",
      );
    });
    const renames = fetch.mock.calls.filter(
      ([request]) => request.method === "PUT",
    );
    expect(renames).toHaveLength(1);
    expect(await renames[0]?.[0].json()).toEqual({
      title: "Synthetic Chapter Two",
    });
  });

  it("leaves the title as it was on Escape", async () => {
    const fetch = stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Synthetic Chapter One" }),
    );
    const field = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.change(field, { target: { value: "Discarded" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);

    expect(
      screen.getByRole("button", { name: "Synthetic Chapter One" }),
    ).toBeTruthy();
    expect(fetch.mock.calls.some(([request]) => request.method === "PUT")).toBe(
      false,
    );
  });

  it("marks the writing surface and title with the document's language and lets the writer change it", async () => {
    let language = "en";
    const title = "¿Dónde está el faro?";
    const markdown = "¡Qué silencio sobre la bahía! La lámpara ardía.\n";
    const fetch = stubFetch(async (request) => {
      const path = new URL(request.url).pathname;
      if (
        request.method === "PUT" &&
        path === `/api/v1/documents/${documentId}/language`
      ) {
        const body: unknown = await request.clone().json();
        if (typeof body === "object" && body && "language" in body) {
          language = String(body.language);
        }
        return Response.json({
          id: documentId,
          parentId: null,
          title,
          language,
          revision: "r1",
        });
      }
      if (path === "/api/v1/workspace") {
        return Response.json({
          items: [
            {
              id: documentId,
              kind: "document",
              parentId: null,
              title,
              language,
            },
          ],
        });
      }
      if (path === `/api/v1/documents/${documentId}`) {
        return Response.json({
          id: documentId,
          parentId: null,
          title,
          language,
          revision: "r1",
        });
      }
      if (path === `/api/v1/documents/${documentId}/content`) {
        return Response.json({ markdown, revision: "r1" });
      }
      return healthyService(request);
    });
    renderApp(`/documents/${documentId}`);

    const surface = await screen.findByRole("textbox", { name: title });
    expect(surface.getAttribute("lang")).toBe("en");
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("lang")).toBe(
      "en",
    );

    const picker = screen.getByRole("button", { name: /Document language/i });
    expect(picker.textContent).toContain("English");
    fireEvent.click(picker);
    const spanish = await screen.findByRole("option", { name: "Español" });
    fireEvent.click(spanish);

    await waitFor(() => {
      expect(surface.getAttribute("lang")).toBe("es");
    });
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("lang")).toBe(
      "es",
    );
    expect(picker.textContent).toContain("Español");

    fireEvent.click(screen.getByRole("button", { name: title }));
    expect(
      screen
        .getByRole("textbox", { name: "Document title" })
        .getAttribute("lang"),
    ).toBe("es");

    const updates = fetch.mock.calls.filter(
      ([request]) =>
        request.method === "PUT" && request.url.endsWith("/language"),
    );
    expect(updates).toHaveLength(1);
    expect(await updates[0]?.[0].json()).toEqual({ language: "es" });
  });
});

function messageBox() {
  return screen.getByRole("textbox", { name: "Message the assistant" });
}

function transcript() {
  return screen.getByRole("log", { name: "Conversation" });
}

describe("assistant", () => {
  it("asks the writer to open a document when none is open", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    expect(
      screen.getByText(/Open a document in the navigator to chat/i),
    ).toBeTruthy();
    fireEvent.change(messageBox(), { target: { value: "Is this too slow?" } });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("streams a reply for the open document with a quote link and What it read", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    fireEvent.change(messageBox(), {
      target: { value: "  Is the opening\ntoo slow? " },
    });
    fireEvent.keyDown(messageBox(), { key: "Enter" });

    expect(
      await within(transcript()).findByRole("button", {
        name: "“The lamp burned low through the night.”",
      }),
    ).toBeTruthy();
    expect(within(transcript()).getByText("What it read")).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "");
  });

  it("starts a new line on Shift+Enter and sends nothing blank", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    fireEvent.change(messageBox(), { target: { value: "A first line" } });
    fireEvent.keyDown(messageBox(), { key: "Enter", shiftKey: true });
    expect(messageBox()).toHaveProperty("value", "A first line");

    fireEvent.change(messageBox(), { target: { value: "   " } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(transcript()).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("keeps the conversation while docked panes collapse and overlaid panes close", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    fireEvent.change(messageBox(), { target: { value: "Keep this." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await within(transcript()).findByText("What it read");

    fireEvent.click(toggle("Assistant"));
    fireEvent.click(toggle("Assistant"));
    expect(within(transcript()).getByText("Keep this.")).toBeTruthy();

    cleanup();
    stubViewport(false);
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    fireEvent.click(toggle("Assistant"));
    const dialog = await screen.findByRole("dialog", { name: "Assistant" });
    fireEvent.change(messageBox(), { target: { value: "Keep overlaid." } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await within(transcript()).findByText("What it read");
    fireEvent.change(messageBox(), { target: { value: "Half a thought" } });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    });
    fireEvent.click(toggle("Assistant"));
    await screen.findByRole("dialog", { name: "Assistant" });

    expect(within(transcript()).getByText("Keep overlaid.")).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "Half a thought");
  });

  it("shows the setup notice, keeps the typed message, and clears without reload", async () => {
    let ready = false;
    stubFetch((request) => {
      if (new URL(request.url).pathname === "/api/v1/pair-writer") {
        return Promise.resolve(
          Response.json(
            ready
              ? {
                  ready: true,
                  provider: "scripted",
                  model: "scripted-pair-writer",
                  issue: null,
                  detail: null,
                }
              : {
                  ready: false,
                  provider: "scripted",
                  model: "scripted-pair-writer",
                  issue: "modelMissing",
                  detail: "Model scripted-pair-writer is not installed.",
                },
          ),
        );
      }
      return healthyService(request);
    });
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    expect(
      await screen.findByText(/Model “scripted-pair-writer” is not available/i),
    ).toBeTruthy();
    expect(screen.getByText(/service\/README\.md/)).toBeTruthy();

    fireEvent.change(messageBox(), { target: { value: "Keep my question" } });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true,
    );

    ready = true;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(
        screen.queryByText(/Model “scripted-pair-writer” is not available/i),
      ).toBeNull();
    });
    expect(messageBox()).toHaveProperty("value", "Keep my question");
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("clears the Ollama setup notice on window focus without reload and keeps metrics out of What it read", async () => {
    let ollamaReady = false;
    stubFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/pair-writer") {
        return Promise.resolve(
          Response.json(
            ollamaReady
              ? {
                  ready: true,
                  provider: "ollama",
                  model: "gemma4:31b-mlx",
                  issue: null,
                  detail: null,
                }
              : {
                  ready: false,
                  provider: "ollama",
                  model: "gemma4:31b-mlx",
                  issue: "runtimeUnreachable",
                  detail:
                    "Ollama is not reachable at http://127.0.0.1:11434. Start Ollama or check OLLAMA_HOST.",
                },
          ),
        );
      }
      if (path === "/api/v1/pair-writer/replies" && request.method === "POST") {
        return Promise.resolve(
          sseResponse([
            {
              event: "delta",
              data: {
                text: '1. In "The lamp burned low through the night.", tighten *through the night*.',
              },
            },
            {
              event: "done",
              data: {
                model: "gemma4:31b-mlx",
                promptVersion: "conversation-grounded@c0a3c0b9f874",
                sources: [
                  {
                    kind: "document",
                    documentId,
                    title: "Synthetic Chapter One",
                    scope: "whole",
                    wordCount: 7,
                    label: "Synthetic Chapter One · whole · 7 words",
                  },
                ],
                totalWords: 7,
                droppedHistoryTurns: 0,
                metrics: {
                  firstTokenMs: 1842,
                  totalMs: 4120,
                  loadMs: 12,
                  promptEvalMs: 1790,
                  evalMs: 2280,
                  promptTokens: 315,
                  outputTokens: 64,
                },
              },
            },
          ]),
        );
      }
      return healthyService(request);
    });

    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    expect(await screen.findByText("Ollama is not reachable")).toBeTruthy();
    expect(screen.getByText(/service\/README\.md/)).toBeTruthy();

    ollamaReady = true;
    globalThis.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(screen.queryByText("Ollama is not reachable")).toBeNull();
    });

    fireEvent.change(messageBox(), { target: { value: "Check opening" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const disclosure = await within(transcript()).findByText("What it read");
    fireEvent.click(disclosure);
    expect(
      within(transcript()).getByText("Model: gemma4:31b-mlx"),
    ).toBeTruthy();
    expect(
      within(transcript()).getByText(
        "Prompt: conversation-grounded@c0a3c0b9f874",
      ),
    ).toBeTruthy();
    // Runtime timing and token counts belong to the done event, not What it read.
    expect(within(transcript()).queryByText(/1842|4120|315/)).toBeNull();
  });

  it("navigates between the active thread and the full-pane Chats list", async () => {
    stubFetch(healthyService);
    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });

    const assistant = screen.getByRole("complementary", { name: "Assistant" });
    expect(
      within(assistant).getByRole("heading", { name: "New chat", level: 2 }),
    ).toBeTruthy();

    fireEvent.change(messageBox(), { target: { value: "First thread note" } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await within(transcript()).findByText("What it read");

    // Back arrow opens the full-pane Chats list with New chat and both sections.
    fireEvent.click(within(assistant).getByRole("button", { name: /^Chats/ }));
    expect(
      within(assistant).getByRole("heading", { name: "Chats", level: 2 }),
    ).toBeTruthy();
    expect(within(assistant).getByText("This document")).toBeTruthy();
    expect(within(assistant).getByText("All chats")).toBeTruthy();

    // New chat creates a fresh thread from the list view.
    fireEvent.click(
      within(assistant).getByRole("button", { name: "New chat" }),
    );
    expect(
      within(assistant).getByRole("heading", { name: "New chat", level: 2 }),
    ).toBeTruthy();
    fireEvent.change(messageBox(), { target: { value: "Second thread note" } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await within(transcript()).findByText("What it read");

    // Return to the Chats list, open the first thread, then delete the second from the list.
    fireEvent.click(within(assistant).getByRole("button", { name: /^Chats/ }));
    const firstButtons = within(assistant).getAllByRole("button", {
      name: /First thread note/,
    });
    const firstRow = firstButtons.find(
      (btn) => !btn.getAttribute("aria-label")?.startsWith("Delete "),
    );
    expect(firstRow).toBeTruthy();
    fireEvent.click(firstRow!);
    expect(within(transcript()).getByText("First thread note")).toBeTruthy();

    fireEvent.click(within(assistant).getByRole("button", { name: /^Chats/ }));
    const deleteSecond = within(assistant).getAllByRole("button", {
      name: "Delete Second thread note",
    })[0];
    expect(deleteSecond).toBeTruthy();
    fireEvent.click(deleteSecond!);
    fireEvent.click(
      within(assistant).getByRole("button", { name: "Confirm delete" }),
    );
    expect(within(assistant).queryByText("Second thread note")).toBeNull();
  });

  it("shows Stop immediately while readiness is pending and restores the draft if stopped", async () => {
    let readinessCalls = 0;
    let replyCalls = 0;
    const pendingReadiness: { resolve: ((res: Response) => void) | null } = {
      resolve: null,
    };

    stubFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/pair-writer") {
        readinessCalls += 1;
        if (readinessCalls === 1) {
          return healthyService(request);
        }
        return new Promise<Response>((resolve) => {
          pendingReadiness.resolve = resolve;
        });
      }
      if (path === "/api/v1/pair-writer/replies") {
        replyCalls += 1;
      }
      return healthyService(request);
    });

    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });
    await waitFor(() => {
      expect(readinessCalls).toBe(1);
    });

    fireEvent.change(messageBox(), { target: { value: "Check pacing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Stop appears synchronously before readiness resolves, and the box clears.
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "");

    fireEvent.click(stop);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "Check pacing");

    pendingReadiness.resolve?.(
      Response.json({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(replyCalls).toBe(0);
  });

  it("captures the original document if the writer switches documents during readiness", async () => {
    const secondDocId = "1c7f4d0e-6e2b-4d3c-8f8a-2b3c4d5e6f7a";
    let readinessCalls = 0;
    const pendingReadiness: { resolve: ((res: Response) => void) | null } = {
      resolve: null,
    };
    let sentContent: string | null = null;

    stubFetch(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/workspace") {
        return Response.json({
          items: [
            {
              id: documentId,
              kind: "document",
              parentId: null,
              title: "Synthetic Chapter One",
              language: "en",
            },
            {
              id: secondDocId,
              kind: "document",
              parentId: null,
              title: "Synthetic Chapter Two",
              language: "en",
            },
          ],
        });
      }
      if (path === `/api/v1/documents/${secondDocId}`) {
        return Response.json({
          id: secondDocId,
          parentId: null,
          title: "Synthetic Chapter Two",
          language: "en",
          revision: "r2",
        });
      }
      if (path === `/api/v1/documents/${secondDocId}/content`) {
        return Response.json({
          markdown: "Rain swept over the stone pier.\n",
          revision: "r2",
        });
      }
      if (path === "/api/v1/pair-writer") {
        readinessCalls += 1;
        if (readinessCalls === 1) {
          return healthyService(request);
        }
        return new Promise<Response>((resolve) => {
          pendingReadiness.resolve = resolve;
        });
      }
      if (path === "/api/v1/pair-writer/replies" && request.method === "POST") {
        const body: unknown = await request.clone().json();
        if (
          typeof body === "object" &&
          body !== null &&
          "document" in body &&
          typeof body.document === "object" &&
          body.document !== null &&
          "content" in body.document &&
          typeof body.document.content === "string"
        ) {
          sentContent = body.document.content;
        }
        return healthyService(request);
      }
      return healthyService(request);
    });

    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });
    await waitFor(() => {
      expect(readinessCalls).toBe(1);
    });

    fireEvent.change(messageBox(), {
      target: { value: "Check chapter one opening" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

    // Switch to Chapter Two before readiness returns.
    const nav = screen.getByRole("navigation", { name: "Navigator" });
    fireEvent.click(within(nav).getByText("Synthetic Chapter Two"));
    await screen.findByRole("textbox", { name: "Synthetic Chapter Two" });

    pendingReadiness.resolve?.(
      Response.json({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
    );

    await waitFor(() => {
      expect(sentContent).toBe("The lamp burned *low* through the night.\n");
    });
    // Chapter Two stays on its own New chat view instead of being hijacked by Chapter One's thread.
    const assistant = screen.getByRole("complementary", { name: "Assistant" });
    expect(
      within(assistant).getByRole("heading", { name: "New chat", level: 2 }),
    ).toBeTruthy();
  });

  it("refreshes readiness and shows the setup notice when /replies returns 503 unavailable", async () => {
    let readinessChecks = 0;
    stubFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/pair-writer") {
        readinessChecks += 1;
        // Ready on pane open and pre-send check, then missing on the refresh after 503.
        if (readinessChecks <= 2) {
          return healthyService(request);
        }
        return Promise.resolve(
          Response.json({
            ready: false,
            provider: "scripted",
            model: "scripted-pair-writer",
            issue: "modelMissing",
            detail: "Model scripted-pair-writer is not installed.",
          }),
        );
      }
      if (path === "/api/v1/pair-writer/replies" && request.method === "POST") {
        return Promise.resolve(
          problem(
            503,
            "unavailable",
            "The configured pair-writer model is not installed.",
          ),
        );
      }
      return healthyService(request);
    });

    renderApp(`/documents/${documentId}`);
    await screen.findByRole("textbox", { name: "Synthetic Chapter One" });
    await waitFor(() => {
      expect(readinessChecks).toBe(1);
    });

    fireEvent.change(messageBox(), { target: { value: "Review this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText(/Model “scripted-pair-writer” is not available/i),
    ).toBeTruthy();
    expect(readinessChecks).toBe(3);
  });
});

describe("service availability", () => {
  it("says so when the service is unreachable", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    renderApp();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe(
      "Writer can't reach the service",
    );
    expect(screen.queryByText("No document is open")).toBeNull();
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("names the HTTP status when a proxy answers without a problem", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(null, {
          status: 502,
          headers: { "Content-Type": "text/plain", "Content-Length": "0" },
        }),
      ),
    );
    renderApp();

    expect(
      await screen.findByText(
        "Start the service, then try again. The request ended with HTTP 502.",
      ),
    ).toBeTruthy();
  });

  it("shows a problem the service reports", async () => {
    stubFetch(() =>
      Promise.resolve(
        problem(500, "internalError", "Synthetic failure for the test."),
      ),
    );
    renderApp();

    expect(
      await screen.findByText("Synthetic failure for the test. (HTTP 500)"),
    ).toBeTruthy();
  });

  it("keeps the message and its button while trying again", async () => {
    // Fails the health check fast until its query settles, then hangs like a
    // slow network.
    let healthChecks = 0;
    stubFetch((request) => {
      if (new URL(request.url).pathname !== "/api/v1/health") {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      healthChecks += 1;
      return healthChecks <= 4
        ? Promise.reject(new TypeError("Failed to fetch"))
        : new Promise<Response>(() => {});
    });
    renderApp("/", { retryDelay: 0 });
    // The first attempt and three retries all fail, so the query settles.
    await waitFor(() => {
      expect(healthChecks).toBe(4);
    });
    const alert = await screen.findByRole("alert");
    const retry = within(alert).getByRole("button", { name: "Try again" });

    fireEvent.click(retry);
    // Lets the query's batched updates render before checking.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.getByRole("alert")).toBe(alert);
    expect(within(alert).getByRole("button")).toBe(retry);
    expect(screen.queryByText("No document is open")).toBeNull();
  });

  it("recovers when the service answers again", async () => {
    let reachable = false;
    stubFetch((request) =>
      reachable
        ? healthyService(request)
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    // Retries fail at once, so trying again never waits out a retry delay.
    renderApp("/", { retryDelay: 0 });
    await screen.findByRole("alert");

    reachable = true;
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", {
        name: "Try again",
      }),
    );

    expect(await screen.findByText("No document is open")).toBeTruthy();
  });
});
