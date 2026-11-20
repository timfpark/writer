import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function stubFetch(respond: (request: Request) => Promise<Response>) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(respond);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("shows the service's health status from a same-origin request", async () => {
    const fetch = stubFetch(() =>
      Promise.resolve(Response.json({ status: "ok" })),
    );

    render(<App />);

    expect(screen.getByRole("status").textContent).toBe(
      "Checking the service…",
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Service status: ok",
    );
    const request = fetch.mock.calls[0]?.[0];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe(`${window.location.origin}/api/v1/health`);
  });

  it("shows a problem details error from the service", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Internal Server Error",
            status: 500,
            detail: "Synthetic failure for the test.",
            code: "internalError",
            errors: [],
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );

    render(<App />);

    expect(
      await screen.findByText(
        "Service status: error 500 Internal Server Error. Synthetic failure for the test.",
      ),
    ).toBeTruthy();
  });

  it("reports the service as unreachable when the proxy answers without a problem", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(null, {
          status: 502,
          headers: { "Content-Type": "text/plain", "Content-Length": "0" },
        }),
      ),
    );

    render(<App />);

    expect(
      await screen.findByText(
        "Service status: unreachable (HTTP 502). Start the service, then reload this page.",
      ),
    ).toBeTruthy();
  });

  it("reports the service as unreachable when the request fails", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    render(<App />);

    expect(
      await screen.findByText(
        "Service status: unreachable. Start the service, then reload this page.",
      ),
    ).toBeTruthy();
  });
});
