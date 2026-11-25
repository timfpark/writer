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
import { notConnectedReply } from "./workspace/conversation";

const documentId = "0b6f3c9e-5d1a-4c2b-9e7f-1a2b3c4d5e6f";

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
  // The router resets scroll on navigation, which jsdom does not implement.
  vi.stubGlobal("scrollTo", () => {});
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
  it("shows a sent message and the stub's reply without any request", async () => {
    const fetch = stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");
    const requests = fetch.mock.calls.length;

    fireEvent.change(messageBox(), {
      target: { value: "  Is the opening\ntoo slow? " },
    });
    fireEvent.keyDown(messageBox(), { key: "Enter" });

    await within(transcript()).findByText(notConnectedReply);
    const messages = within(transcript()).getAllByRole("listitem");
    expect(messages.map((message) => message.textContent)).toEqual([
      "YouIs the opening\ntoo slow?",
      `Assistant${notConnectedReply}`,
    ]);
    expect(messageBox()).toHaveProperty("value", "");
    expect(fetch.mock.calls.length).toBe(requests);
  });

  it("starts a new line on Shift+Enter and sends nothing blank", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

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

  it("sends from the Send button", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    fireEvent.change(messageBox(), { target: { value: "Name the harbor." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await within(transcript()).findByText(notConnectedReply),
    ).toBeTruthy();
  });

  it("keeps the conversation while a docked pane collapses and expands", async () => {
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");
    fireEvent.change(messageBox(), { target: { value: "Keep this." } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await within(transcript()).findByText(notConnectedReply);

    fireEvent.click(toggle("Assistant"));
    fireEvent.click(toggle("Assistant"));

    expect(within(transcript()).getByText("Keep this.")).toBeTruthy();
    expect(within(transcript()).getByText(notConnectedReply)).toBeTruthy();
  });

  it("keeps the conversation and the draft while an overlaid pane closes", async () => {
    stubViewport(false);
    stubFetch(healthyService);
    renderApp();
    await screen.findByText("No document is open");

    fireEvent.click(toggle("Assistant"));
    const dialog = await screen.findByRole("dialog", { name: "Assistant" });
    fireEvent.change(messageBox(), { target: { value: "Keep this." } });
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    await within(transcript()).findByText(notConnectedReply);
    fireEvent.change(messageBox(), { target: { value: "Half a thought" } });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    });
    fireEvent.click(toggle("Assistant"));
    await screen.findByRole("dialog", { name: "Assistant" });

    expect(within(transcript()).getByText("Keep this.")).toBeTruthy();
    expect(within(transcript()).getByText(notConnectedReply)).toBeTruthy();
    expect(messageBox()).toHaveProperty("value", "Half a thought");
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
