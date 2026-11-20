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
  if (path === `/api/v1/documents/${documentId}`) {
    return Promise.resolve(
      Response.json({
        id: documentId,
        parentId: null,
        title: "Synthetic Chapter One",
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
    expect(paths).toEqual(["/api/v1/health"]);
  });

  it("shows a not-found message for any other path", async () => {
    stubFetch(healthyService);
    renderApp("/elsewhere");

    expect(await screen.findByText("This page does not exist")).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
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
    // Fails fast until the query settles, then hangs like a slow network.
    const fetch = stubFetch(() =>
      fetch.mock.calls.length <= 4
        ? Promise.reject(new TypeError("Failed to fetch"))
        : new Promise<Response>(() => {}),
    );
    renderApp("/", { retryDelay: 0 });
    // The first attempt and three retries all fail, so the query settles.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(4);
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
    renderApp();
    await screen.findByRole("alert");

    reachable = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No document is open")).toBeTruthy();
  });
});
