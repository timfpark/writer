import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

type PaneName = "Navigator" | "Assistant";

const paneNames: PaneName[] = ["Navigator", "Assistant"];
const landmarks = {
  Navigator: "navigation",
  Assistant: "complementary",
} as const;

// ADR 0007's breakpoints, 60 and 75 rem, in CSS pixels at the 16 px root.
const docksFrom: Record<PaneName, number> = { Navigator: 960, Assistant: 1200 };

function docked(viewport: ViewportSize | null, name: PaneName): boolean {
  return (viewport?.width ?? 0) >= docksFrom[name];
}

function pane(page: Page, name: PaneName): Locator {
  return page.getByRole(landmarks[name], { name });
}

function toggle(page: Page, name: PaneName): Locator {
  return page.getByRole("banner").getByRole("button", { name, exact: true });
}

// Taps on touch screens and clicks elsewhere, as a writer would.
async function press(locator: Locator, hasTouch: boolean) {
  if (hasTouch) await locator.tap();
  else await locator.click();
}

// Browser test runs share one service, so every title is unique to its test.
function unique(label: string): string {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

const paneShortcuts: Record<PaneName, string> = {
  Navigator: "ControlOrMeta+Backslash",
  Assistant: "ControlOrMeta+Shift+Backslash",
};

// Loads the workspace and waits until the real service has answered through
// the development server's proxy.
async function openWorkspace(page: Page) {
  const health = page.waitForResponse("**/api/v1/health");
  await page.goto("/");
  expect((await health).status()).toBe(200);
  await expect(page.getByText("No document is open")).toBeVisible();
}

test("shows the workspace from the running service", async ({
  page,
  viewport,
}) => {
  await openWorkspace(page);

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Writer");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const name of paneNames) {
    if (docked(viewport, name)) await expect(pane(page, name)).toBeVisible();
    else await expect(pane(page, name)).toBeHidden();
  }
  await expectAccessible(page);
});

test("collapses docked panes from the header and remembers it across reloads", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const names = paneNames.filter((name) => docked(viewport, name));
  test.skip(names.length === 0, "no pane docks at this width");
  await openWorkspace(page);

  for (const name of names) {
    await press(toggle(page, name), hasTouch);
    await expect(pane(page, name)).toBeHidden();
    await expect(toggle(page, name)).toHaveAttribute("aria-pressed", "false");
  }
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByText("No document is open")).toBeVisible();
  for (const name of names) {
    await expect(pane(page, name)).toBeHidden();
    await expect(toggle(page, name)).toHaveAttribute("aria-pressed", "false");
  }

  for (const name of names) {
    await press(toggle(page, name), hasTouch);
    await expect(pane(page, name)).toBeVisible();
    await expect(toggle(page, name)).toHaveAttribute("aria-pressed", "true");
  }
});

test("opens overlaid panes over the writing region and closes them", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const names = paneNames.filter((name) => !docked(viewport, name));
  test.skip(names.length === 0, "every pane docks at this width");
  await openWorkspace(page);

  for (const name of names) {
    const dialog = page.getByRole("dialog", { name });
    await press(toggle(page, name), hasTouch);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole(landmarks[name], { name })).toBeVisible();
    await expectAccessible(page);

    // The pane has no close button; a tap outside it, on the far side of
    // the writing region, closes it.
    const width = viewport?.width ?? 0;
    const outside = {
      x: name === "Navigator" ? width - 16 : 16,
      y: (viewport?.height ?? 0) / 2,
    };
    if (hasTouch) await page.touchscreen.tap(outside.x, outside.y);
    else await page.mouse.click(outside.x, outside.y);
    await expect(dialog).toBeHidden();

    await press(toggle(page, name), hasTouch);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  // An overlaid pane always starts closed, whatever happened before.
  await press(toggle(page, names[0] ?? "Navigator"), hasTouch);
  await page.reload();
  await expect(page.getByText("No document is open")).toBeVisible();
  for (const name of names) await expect(pane(page, name)).toBeHidden();
});

test("gives header controls touch-sized targets on touch screens", async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch, "the touch rules apply to coarse pointers only");
  await openWorkspace(page);

  const buttons = await page.getByRole("banner").getByRole("button").all();
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test("moves focus between the panes with F6 and back to the page as a pane closes", async ({
  page,
  viewport,
}) => {
  const title = unique("Focus");
  await openWorkspace(page);
  const documentId = crypto.randomUUID();
  const created = await page.request.post("/api/v1/documents", {
    data: { documentId, parentId: null, beforeId: null, title },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();
  const targets: Record<PaneName, Locator> = {
    Navigator: pane(page, "Navigator").getByRole("row", {
      name: title,
      exact: true,
    }),
    Assistant: page.getByRole("textbox", { name: "Message the assistant" }),
  };
  if (docked(viewport, "Navigator"))
    await expect(targets.Navigator).toBeVisible();

  // F6 visits the docked panes and the page in order and wraps around;
  // Shift+F6 goes back.
  const stops = [
    ...(docked(viewport, "Navigator") ? [targets.Navigator] : []),
    editor,
    ...(docked(viewport, "Assistant") ? [targets.Assistant] : []),
  ];
  for (const stop of [...stops, ...stops.slice(0, 1)]) {
    await page.keyboard.press("F6");
    await expect(stop).toBeFocused();
  }
  await page.keyboard.press("Shift+F6");
  await expect(stops.at(-1) ?? editor).toBeFocused();
  await expectAccessible(page);

  for (const name of paneNames) {
    await expect(async () => {
      await page.keyboard.press("F6");
      await expect(docked(viewport, name) ? targets[name] : editor).toBeFocused(
        { timeout: 250 },
      );
    }).toPass();
    await page.keyboard.press(paneShortcuts[name]);
    if (docked(viewport, name)) {
      // Hiding a docked pane that holds focus moves focus to the page.
      await expect(pane(page, name)).toBeHidden();
    } else {
      // A pane over the page holds focus, which F6 moves to its control,
      // and returns it to the page as it closes.
      const dialog = page.getByRole("dialog", { name });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("F6");
      await expect(targets[name]).toBeFocused();
      await expectAccessible(page);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    await expect(editor).toBeFocused();
  }
});

test("lists the keyboard shortcuts from the header and with Mod+/", async ({
  page,
  hasTouch,
}) => {
  await openWorkspace(page);
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await press(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Keyboard shortcuts" }),
    hasTouch,
  );
  await expect(dialog).toBeVisible();
  for (const group of ["Workspace", "Navigator", "Writing", "Assistant"]) {
    await expect(dialog.getByRole("heading", { name: group })).toBeVisible();
  }
  await expect(dialog).toContainText("Move focus to the next or previous pane");
  await expectAccessible(page);
  await press(dialog.getByRole("button", { name: "Close" }), hasTouch);
  await expect(dialog).toBeHidden();

  await page.keyboard.press("ControlOrMeta+Slash");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
