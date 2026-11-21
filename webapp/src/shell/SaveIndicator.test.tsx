import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceError } from "../api/queries";
import type { SaveStatus } from "../saving/documentSaver";
import { SaveIndicator } from "./SaveIndicator";

afterEach(cleanup);

function renderStatus(status: SaveStatus) {
  const { container } = render(<SaveIndicator status={status} />);
  const badge = container.querySelector("[data-state]");
  if (!(badge instanceof HTMLElement)) throw new Error("no status shown");
  return { badge, icons: container.querySelectorAll("svg") };
}

describe("save indicator", () => {
  it("shows a saved document as a badge with a hidden check icon", () => {
    const { badge, icons } = renderStatus({ state: "saved" });

    expect(badge.textContent).toBe("Saved");
    expect(badge.dataset["state"]).toBe("saved");
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it.each([
    [{ state: "saving" }, "Saving…", ""],
    [
      { state: "retrying" },
      "Retrying…",
      "Writer can't reach the service and keeps retrying.",
    ],
    [{ state: "conflict" }, "Conflict", "This document changed elsewhere."],
    [
      {
        state: "failed",
        problem: new ServiceError(
          {
            type: "about:blank",
            title: "",
            status: 413,
            detail: "",
            code: "payloadTooLarge",
            errors: [],
          },
          413,
        ),
      },
      "Not saved",
      "This document is over 1 MiB",
    ],
  ] satisfies [SaveStatus, string, string][])(
    "shows %o as text without the saved badge's icon",
    (status, label, message) => {
      const { badge, icons } = renderStatus(status);

      expect(badge.textContent).toBe(label);
      expect(badge.dataset["state"]).toBe(status.state);
      expect(icons).toHaveLength(0);
      expect(screen.getByRole("status").textContent).toContain(message);
    },
  );
});
