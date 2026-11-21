import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";
import { writeDocumentFile } from "./outside.js";
import { servicePort } from "./ports";

// ADR 0007's navigator breakpoint, 60 rem, in CSS pixels at the 16 px root.
function docked(viewport: ViewportSize | null): boolean {
  return (viewport?.width ?? 0) >= 960;
}

// Browser test runs share one service, so every title is unique to its test.
function unique(label: string): string {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

// Taps on touch screens and clicks elsewhere, as a writer would.
async function press(locator: Locator, hasTouch: boolean) {
  if (hasTouch) await locator.tap();
  else await locator.click();
}

function isContent(value: unknown): value is { markdown: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "markdown" in value &&
    typeof value.markdown === "string"
  );
}

function isWorkspace(
  value: unknown,
): value is { items: { id: string; title: string }[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

// Creates a document through the service, at the top level or in a folder.
async function createDocument(
  page: Page,
  title: string,
  markdown = "",
  parentId: string | null = null,
): Promise<string> {
  const documentId = crypto.randomUUID();
  const response = await page.request.post("/api/v1/documents", {
    data: { documentId, parentId, beforeId: null, title, markdown },
  });
  expect(response.status()).toBe(201);
  return documentId;
}

async function createFolder(page: Page, title: string): Promise<string> {
  const folderId = crypto.randomUUID();
  const response = await page.request.post("/api/v1/folders", {
    data: { folderId, parentId: null, beforeId: null, title },
  });
  expect(response.status()).toBe(201);
  return folderId;
}

// Types at a steady pace rather than all at once, as a writer would, so each
// keystroke lands after the editor has applied the one before.
async function type(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 60 });
}

// Moves the caret with a key the browser handles, then waits a frame for it
// to report the new selection, as it does long before a writer's next key.
async function moveCaret(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
  );
}

async function storedContent(page: Page, documentId: string): Promise<string> {
  const response = await page.request.get(
    `/api/v1/documents/${documentId}/content`,
  );
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (!isContent(body)) throw new Error("content response has no markdown");
  return body.markdown;
}

async function workspaceItems(page: Page) {
  const response = await page.request.get("/api/v1/workspace");
  const body: unknown = await response.json();
  if (!isWorkspace(body)) throw new Error("workspace response has no items");
  return body.items;
}

function surface(page: Page, title: string): Locator {
  return page.getByRole("textbox", { name: title, exact: true });
}

async function openDocument(page: Page, documentId: string, title: string) {
  await page.goto(`/documents/${documentId}`);
  const editor = surface(page, title);
  await expect(editor).toBeVisible();
  return editor;
}

function saveStatus(page: Page, label: string): Locator {
  return page.getByRole("banner").getByText(label, { exact: true });
}

function isContentPath(url: URL): boolean {
  return /^\/api\/v1\/documents\/[^/]+\/content$/.test(url.pathname);
}

test("saves typed text without an explicit save and keeps it after a reload", async ({
  page,
  hasTouch,
}) => {
  const title = unique("Harbor");
  const documentId = await createDocument(page, title);
  const editor = await openDocument(page, documentId, title);
  await expect(saveStatus(page, "Saved")).toBeVisible();

  await press(editor, hasTouch);
  await type(page, "Gulls wheeled over the harbor at dawn.");
  await expect
    .poll(() => storedContent(page, documentId))
    .toBe("Gulls wheeled over the harbor at dawn.\n");
  await expect(saveStatus(page, "Saved")).toBeVisible();
  await expectAccessible(page);

  await page.reload();
  await expect(surface(page, title)).toHaveText(
    "Gulls wheeled over the harbor at dawn.",
  );
});

test("saves at once on Mod+S and formats from the keyboard", async ({
  page,
  hasTouch,
}) => {
  const title = unique("Quay");
  const documentId = await createDocument(page, title);
  const editor = await openDocument(page, documentId, title);
  await press(editor, hasTouch);
  await type(page, "## Lanterns");
  await page.keyboard.press("Enter");
  await type(page, "Ropes creaked ");
  await page.keyboard.press("ControlOrMeta+b");
  await type(page, "loudly");
  await page.keyboard.press("ControlOrMeta+b");
  await type(page, ".");

  // The idle delay is a second, so a save this soon came from the shortcut.
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/content"),
    { timeout: 800 },
  );
  await page.keyboard.press("ControlOrMeta+s");
  await saved;
  await expect
    .poll(() => storedContent(page, documentId))
    .toBe("## Lanterns\n\nRopes creaked **loudly**.\n");
});

test("creates, edits, and removes a link from the keyboard", async ({
  page,
  hasTouch,
}) => {
  const title = unique("Chart");
  const documentId = await createDocument(page, title);
  const editor = await openDocument(page, documentId, title);
  await press(editor, hasTouch);
  await type(page, "See the chart");
  for (let index = 0; index < "chart".length; index++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await expect(dialog).toBeVisible();
  const address = dialog.getByRole("textbox", { name: "Address" });
  await expect(address).toBeFocused();
  await expectAccessible(page);
  await address.fill("javascript:alert(1)");
  await address.press("Enter");
  await expect(
    dialog.getByText("Use a web, mail, or phone address."),
  ).toBeVisible();
  await address.fill("https://example.com/chart");
  await address.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(editor).toBeFocused();
  await expect(editor.getByRole("link", { name: "chart" })).toHaveAttribute(
    "href",
    "https://example.com/chart",
  );
  await moveCaret(page, "End");
  await type(page, ".");
  await expect
    .poll(() => storedContent(page, documentId))
    .toBe("See the [chart](https://example.com/chart).\n");

  // Into the linked word, past the period after it.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ControlOrMeta+k");
  const edit = page.getByRole("dialog", { name: "Edit link" });
  await expect(edit.getByRole("textbox", { name: "Address" })).toHaveValue(
    "https://example.com/chart",
  );
  await edit
    .getByRole("textbox", { name: "Address" })
    .fill("https://example.com/map");
  await edit.getByRole("textbox", { name: "Address" }).press("Enter");
  await expect
    .poll(() => storedContent(page, documentId))
    .toBe("See the [chart](https://example.com/map).\n");

  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("dialog", { name: "Edit link" })
    .getByRole("button", { name: "Remove link" })
    .click();
  await expect(editor.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => storedContent(page, documentId))
    .toBe("See the chart.\n");
});

test("renames the document from the header, and the navigator follows", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Lighthouse");
  const renamed = unique("Lantern room");
  const documentId = await createDocument(page, title);
  await openDocument(page, documentId, title);

  await press(
    page.getByRole("banner").getByRole("button", { name: title }),
    hasTouch,
  );
  const field = page.getByRole("textbox", { name: "Document title" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(title);
  await expectAccessible(page);
  await field.fill(`  ${renamed}  `);
  await field.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);
  await expect(surface(page, renamed)).toBeVisible();

  const navigator = page.getByRole("navigation", { name: "Navigator" });
  if (!docked(viewport)) {
    await press(
      page.getByRole("banner").getByRole("button", {
        name: "Navigator",
        exact: true,
      }),
      hasTouch,
    );
  }
  await expect(
    navigator.getByRole("row", { name: renamed, exact: true }),
  ).toBeVisible();

  // Escape leaves the title as it was.
  if (!docked(viewport)) await page.keyboard.press("Escape");
  await press(
    page.getByRole("banner").getByRole("button", { name: renamed }),
    hasTouch,
  );
  await field.fill("Discarded");
  await field.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);
});

// Over the 64 KiB a page may send as it unloads, so a reload leaves the text
// to the unsaved-text record rather than a last save.
const longOpening = `${Array.from(
  { length: 900 },
  (_, index) =>
    `Wave ${index} broke against the stone wall and ran back into the gray water.`,
).join("\n\n")}\n`;

test("keeps text through an unreachable service and a reload, then saves it", async ({
  page,
  hasTouch,
}) => {
  expect(new TextEncoder().encode(longOpening).length).toBeGreaterThan(
    64 * 1024,
  );
  const title = unique("Breakwater");
  const documentId = await createDocument(page, title, longOpening);
  const editor = await openDocument(page, documentId, title);

  // Saves fail as if the service had stopped; reading still works.
  await page.route(isContentPath, (route) =>
    route.request().method() === "PUT"
      ? route.abort("connectionrefused")
      : route.fallback(),
  );
  await press(editor, hasTouch);
  await moveCaret(page, "ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await type(page, "Fog rolled over the breakwater.");
  await expect(saveStatus(page, "Retrying…")).toBeVisible();
  await expectAccessible(page);

  await page.reload();
  await expect(surface(page, title)).toContainText(
    "Fog rolled over the breakwater.",
  );
  await expect(saveStatus(page, "Retrying…")).toBeVisible();
  expect(await storedContent(page, documentId)).toBe(longOpening);

  await page.unroute(isContentPath);
  await expect(saveStatus(page, "Saved")).toBeVisible({ timeout: 20_000 });
  expect(await storedContent(page, documentId)).toBe(
    `${longOpening}\nFog rolled over the breakwater.\n`,
  );
});

test("keeps both versions when the file changes outside Writer", async ({
  page,
  hasTouch,
}) => {
  // A folder of its own, so no other test's item lands beside the copy.
  const title = unique("Tide");
  const folderId = await createFolder(page, unique("Tides"));
  const documentId = await createDocument(
    page,
    title,
    "The tide came in slowly.\n",
    folderId,
  );
  const editor = await openDocument(page, documentId, title);

  // Holds the recovery's read of the stored content, so the conflict status
  // stays long enough to check.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const content = (url: URL) =>
    url.pathname === `/api/v1/documents/${documentId}/content`;
  await page.route(content, async (route) => {
    if (route.request().method() === "GET") await held;
    await route.fallback();
  });

  writeDocumentFile(
    servicePort,
    documentId,
    "The tide went out in another editor.\n",
  );
  await press(editor, hasTouch);
  await moveCaret(page, "ControlOrMeta+End");
  await type(page, " Writer adds this.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(saveStatus(page, "Conflict")).toBeVisible();
  await expectAccessible(page);

  release();
  await expect(saveStatus(page, "Saved")).toBeVisible();
  const copyTitle = `${title} (saved elsewhere)`;
  const notice = page.getByText(`kept that version as “${copyTitle}”`, {
    exact: false,
  });
  await expect(notice).toBeVisible();
  await expect(editor).toHaveText("The tide came in slowly. Writer adds this.");
  expect(await storedContent(page, documentId)).toBe(
    "The tide came in slowly. Writer adds this.\n",
  );

  const items = await workspaceItems(page);
  const index = items.findIndex((item) => item.id === documentId);
  const copy = items[index + 1];
  expect(copy?.title).toBe(copyTitle);
  expect(await storedContent(page, copy?.id ?? "")).toBe(
    "The tide went out in another editor.\n",
  );

  await page.getByRole("main").getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();
});
