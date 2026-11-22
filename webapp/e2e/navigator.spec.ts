import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";
import { itemLocation } from "./outside.js";
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

interface Context {
  page: Page;
  viewport: ViewportSize | null;
  hasTouch: boolean;
}

function navigatorPane(page: Page): Locator {
  return page.getByRole("navigation", { name: "Navigator" });
}

// The navigator, opened over the writing region first when it does not dock.
async function showNavigator({
  page,
  viewport,
  hasTouch,
}: Context): Promise<Locator> {
  const navigator = navigatorPane(page);
  if (!docked(viewport) && !(await navigator.isVisible())) {
    await press(
      page.getByRole("banner").getByRole("button", {
        name: "Navigator",
        exact: true,
      }),
      hasTouch,
    );
  }
  await expect(navigator).toBeVisible();
  await expect(navigator.getByRole("treegrid")).toBeVisible();
  return navigator;
}

function row(navigator: Locator, title: string): Locator {
  return navigator.getByRole("row", { name: title, exact: true });
}

// Names an item that has just been created, which starts in inline rename,
// and waits for the service to accept the title, so a reload that follows
// cannot cancel the rename while it waits its turn.
async function nameNewItem(navigator: Locator, title: string) {
  const field = navigator.getByRole("textbox", { name: "Title" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Untitled");
  await field.fill(title);
  const renamed = navigator
    .page()
    .waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith("/title"),
    );
  await field.press("Enter");
  expect((await renamed).status()).toBe(200);
  await expect(field).toHaveCount(0);
}

// Runs a command from a row's actions button, the path every input has.
async function rowCommand(
  { page, hasTouch }: Context,
  target: Locator,
  command: string,
) {
  await press(target.getByRole("button", { name: "More actions" }), hasTouch);
  await press(page.getByRole("menuitem", { name: command }), hasTouch);
}

// Waits for a new document to open; an overlaid navigator then closes.
async function expectOpened({ page, viewport }: Context, title: string) {
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  if (!docked(viewport)) await expect(navigatorPane(page)).toBeHidden();
}

interface Built {
  top: string;
  middle: string;
  leaf: string;
  url: string;
}

// Builds folder > folder > document from the navigator alone: the toolbar
// for the top level, the row's hover button or, on touch screens, its menu
// for the second, and the row's menu for the third.
async function buildTree(context: Context, label: string): Promise<Built> {
  const { page, hasTouch } = context;
  const built = {
    top: unique(`${label} part`),
    middle: unique(`${label} chapter`),
    leaf: unique(`${label} scene`),
  };
  let navigator = await showNavigator(context);
  await press(
    navigator.getByRole("toolbar").getByRole("button", { name: "New folder" }),
    hasTouch,
  );
  await nameNewItem(navigator, built.top);
  await expect(row(navigator, built.top)).toHaveAttribute("aria-level", "1");

  if (hasTouch) {
    await rowCommand(context, row(navigator, built.top), "New folder");
  } else {
    await row(navigator, built.top).hover();
    await row(navigator, built.top)
      .getByRole("button", { name: "New folder" })
      .click();
  }
  await nameNewItem(navigator, built.middle);
  await expect(row(navigator, built.middle)).toHaveAttribute("aria-level", "2");

  await rowCommand(context, row(navigator, built.middle), "New document");
  await nameNewItem(navigator, built.leaf);
  await expectOpened(context, built.leaf);

  navigator = await showNavigator(context);
  await expect(row(navigator, built.leaf)).toHaveAttribute("aria-level", "3");
  await expect(row(navigator, built.leaf)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return { ...built, url: page.url() };
}

// Loads a page and waits until the real service has answered through the
// development server's proxy. An overlaid navigator reads the tree only when
// it opens.
async function openWorkspace(page: Page, path = "/") {
  const health = page.waitForResponse("**/api/v1/health");
  await page.goto(path);
  expect((await health).status()).toBe(200);
}

test("builds a three-level tree that survives a reload and reveals an opened document", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const context = { page, viewport, hasTouch };
  await openWorkspace(page);
  const built = await buildTree(context, "Build");
  await expectAccessible(page);

  let navigator = await showNavigator(context);
  await press(
    navigator
      .getByRole("toolbar")
      .getByRole("button", { name: "Collapse all folders" }),
    hasTouch,
  );
  await expect(row(navigator, built.middle)).toHaveCount(0);
  await expect(row(navigator, built.top)).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Opening the document by URL expands the folders around it.
  await openWorkspace(page, built.url);
  navigator = await showNavigator(context);
  for (const [title, level] of [
    [built.top, "1"],
    [built.middle, "2"],
    [built.leaf, "3"],
  ] as const) {
    await expect(row(navigator, title)).toHaveAttribute("aria-level", level);
  }
  await expect(row(navigator, built.top)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(row(navigator, built.leaf)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(built.leaf);
  await expectAccessible(page);

  if (hasTouch) {
    const box = await row(navigator, built.leaf).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("folds subtrees and restores each descendant's state", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const context = { page, viewport, hasTouch };
  await openWorkspace(page);
  const built = await buildTree(context, "Fold");
  await openWorkspace(page);
  let navigator = await showNavigator(context);
  const top = row(navigator, built.top);
  const middle = row(navigator, built.middle);
  const leaf = row(navigator, built.leaf);

  await press(top.getByRole("button", { name: /^Collapse/ }), hasTouch);
  await expect(top).toHaveAttribute("aria-expanded", "false");
  await expect(middle).toHaveCount(0);
  await expect(leaf).toHaveCount(0);
  await expectAccessible(page);

  await press(top.getByRole("button", { name: /^Expand/ }), hasTouch);
  await expect(middle).toHaveAttribute("aria-expanded", "true");
  await expect(leaf).toBeVisible();

  await rowCommand(context, top, "Collapse all inside");
  await expect(middle).toHaveCount(0);
  await press(top.getByRole("button", { name: /^Expand/ }), hasTouch);
  await expect(middle).toHaveAttribute("aria-expanded", "false");
  await expect(leaf).toHaveCount(0);

  await rowCommand(context, top, "Expand all inside");
  await expect(leaf).toBeVisible();

  // Expansion is a stored preference, so it survives a reload.
  await press(middle.getByRole("button", { name: /^Collapse/ }), hasTouch);
  await expect(leaf).toHaveCount(0);
  await page.reload();
  navigator = await showNavigator(context);
  await expect(row(navigator, built.top)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(row(navigator, built.middle)).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Selecting a document opens it and highlights its row.
  await press(row(navigator, built.middle), hasTouch);
  await press(row(navigator, built.leaf), hasTouch);
  await expectOpened(context, built.leaf);
  navigator = await showNavigator(context);
  await expect(row(navigator, built.leaf)).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("restores the tree and explains when a rename or delete fails", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const context = { page, viewport, hasTouch };
  await openWorkspace(page);
  const built = await buildTree(context, "Fail");
  await openWorkspace(page);
  let navigator = await showNavigator(context);
  const top = row(navigator, built.top);

  const internalError = {
    status: 500,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "Synthetic failure for the test.",
      code: "internalError",
      errors: [],
    }),
  };
  await page.route("**/api/v1/folders/*/title", (route) =>
    route.fulfill(internalError),
  );
  await rowCommand(context, top, "Rename");
  const field = navigator.getByRole("textbox", { name: "Title" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(built.top);
  await field.fill(unique("Never saved"));
  await field.press("Enter");
  await expect(
    navigator.getByText(
      "Couldn't rename the folder. The service reported a problem (HTTP 500).",
    ),
  ).toBeVisible();
  await expect(top).toBeVisible();
  await expectAccessible(page);

  await page.route("**/api/v1/folders/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill(internalError)
      : route.fallback(),
  );
  await rowCommand(context, top, "Delete…");
  const dialog = page.getByRole("alertdialog", {
    name: `Delete “${built.top}”?`,
  });
  await expect(dialog).toContainText(
    "This permanently deletes the folder and the 2 items inside it.",
  );
  await expectAccessible(page);
  await press(dialog.getByRole("button", { name: "Delete" }), hasTouch);
  await expect(
    navigator.getByText(
      "Couldn't delete the folder. The service reported a problem (HTTP 500).",
    ),
  ).toBeVisible();
  await expect(top).toBeVisible();
  await expect(row(navigator, built.leaf)).toBeVisible();

  const dismiss = navigator.getByRole("button", { name: "Dismiss" });
  await expect(dismiss).toHaveCount(2);
  await press(dismiss.first(), hasTouch);
  await press(dismiss.first(), hasTouch);
  await expect(dismiss).toHaveCount(0);

  // Once the service accepts it, the folder and everything in it go, and a
  // document open inside it closes.
  await page.unrouteAll({ behavior: "wait" });
  await press(row(navigator, built.leaf), hasTouch);
  await expectOpened(context, built.leaf);
  navigator = await showNavigator(context);
  await rowCommand(context, row(navigator, built.top), "Delete…");
  // Waits for the service, so the reload below cannot cancel the deletion.
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().includes("/api/v1/folders/"),
  );
  await press(dialog.getByRole("button", { name: "Delete" }), hasTouch);
  expect((await deleted).status()).toBe(204);
  await expect(page).toHaveURL(/\/$/);
  navigator = await showNavigator(context);
  await expect(row(navigator, built.top)).toHaveCount(0);
  await page.reload();
  navigator = await showNavigator(context);
  await expect(row(navigator, built.top)).toHaveCount(0);
});

test("moves through the tree, folds folders, and opens a document with the keyboard", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const context = { page, viewport, hasTouch };
  await openWorkspace(page);
  const built = await buildTree(context, "Keys");
  await openWorkspace(page);
  const navigator = await showNavigator(context);
  const top = row(navigator, built.top);
  const middle = row(navigator, built.middle);
  const leaf = row(navigator, built.leaf);
  const rows = navigator.getByRole("row");

  // The tree is one tab stop after the toolbar.
  await navigator
    .getByRole("toolbar")
    .getByRole("button", { name: "Collapse all folders" })
    .focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(rows.first()).toBeFocused();
  await expect(navigator.getByRole("row", { selected: true })).toHaveCount(0);

  // Other tests add rows at the end, so End is pressed again if one arrives
  // after it.
  await expect(async () => {
    await page.keyboard.press("End");
    await expect(rows.last()).toBeFocused({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();

  // Typing a title moves to it.
  await page.keyboard.type(built.top);
  await expect(top).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(top).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(middle).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(middle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(leaf).toBeFocused();
  await expectAccessible(page);

  await page.keyboard.press("ArrowLeft");
  await expect(middle).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(middle).toHaveAttribute("aria-expanded", "false");
  await expect(leaf).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(middle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(leaf).toBeFocused();
  await page.keyboard.press("Enter");
  await expectOpened(context, built.leaf);
});

test("creates items at the top level and in folders from the context menu", async ({
  page,
  viewport,
  hasTouch,
}) => {
  test.skip(hasTouch, "a long press does not reliably raise contextmenu");
  const context = { page, viewport, hasTouch };
  await openWorkspace(page);
  const navigator = await showNavigator(context);
  const folder = unique("Context folder");
  const document = unique("Context document");

  // Below the last row, the menu creates at the top level. Earlier tests'
  // items may fill the pane, so it scrolls to the end first.
  const tree = navigator.getByRole("treegrid");
  await navigator.evaluate((pane) => {
    for (const element of pane.querySelectorAll("*")) {
      element.scrollTop = element.scrollHeight;
    }
  });
  const box = await tree.boundingBox();
  if (!box) throw new Error("the tree has no layout box");
  await page.mouse.click(box.x + 40, box.y + box.height + 16, {
    button: "right",
  });
  await expect(
    page.getByRole("menuitem", { name: "New folder" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await nameNewItem(navigator, folder);
  await expect(row(navigator, folder)).toHaveAttribute("aria-level", "1");

  await row(navigator, folder).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New document" }).click();
  await nameNewItem(navigator, document);
  await expectOpened(context, document);
  const reopened = await showNavigator(context);
  await expect(row(reopened, document)).toHaveAttribute("aria-level", "2");
});

// Creates an item through the service's API, last in its parent, for tests
// about moving items rather than creating them.
async function createItem(
  page: Page,
  kind: "folder" | "document",
  title: string,
  parentId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const response = await page.request.post(`/api/v1/${kind}s`, {
    data: { [`${kind}Id`]: id, parentId, beforeId: null, title },
  });
  expect(response.status()).toBe(201);
  return id;
}

// Drags one row onto a point of another: by default its middle, which drops
// on it, or a given point, which the tests use for the top edge, dropping
// before it. The target is centered first, because near the pane's edges the
// tree scrolls under the pointer, and other tests' items can push it there.
// A busy browser starts the native drag late and may report the pointer's
// last position late, so the pointer moves on only once the row is being
// dragged, and releases only once the intended drop shows, unless the drop is
// expected to be refused.
async function drag(
  source: Locator,
  target: Locator,
  position?: { x: number; y: number },
  { refused = false } = {},
) {
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  const page = source.page();
  const from = await source.boundingBox();
  if (!from) throw new Error("the dragged row has no layout box");
  const start = { x: from.x + 60, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 6, { steps: 3 });
  await expect(source).toHaveAttribute("data-dragging", "true");

  const to = await target.boundingBox();
  if (!to) throw new Error("the target row has no layout box");
  const offset = position ?? { x: to.width / 2, y: to.height / 2 };
  const end = { x: to.x + offset.x, y: to.y + offset.y };
  await page.mouse.move(end.x, end.y, { steps: 5 });
  if (!refused) {
    const title = await target.getAttribute("aria-label");
    const insert = `[aria-label^="Insert"][aria-label$="${title}"]`;
    const shown = position
      ? page.locator(`[data-drop-target]:is(${insert}, :has(${insert}))`)
      : target.and(page.locator("[data-drop-target]"));
    let nudge = 1;
    await expect(async () => {
      nudge = -nudge;
      await page.mouse.move(end.x + nudge, end.y);
      await expect(shown).toHaveCount(1, { timeout: 250 });
    }).toPass();
  }
  await page.mouse.up();
}

// Drags a row to make a move, and waits for the tree to settle: the service
// accepts the move, then the tree is read again, so the next drag never
// starts on rows about to be replaced.
async function dragToMove(
  source: Locator,
  target: Locator,
  position?: { x: number; y: number },
) {
  const reread = source
    .page()
    .waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/v1/workspace",
    );
  await drag(source, target, position);
  await reread;
}

async function expand(navigator: Locator, title: string, hasTouch: boolean) {
  const target = row(navigator, title);
  if ((await target.getAttribute("aria-expanded")) !== "true") {
    await press(target.getByRole("button", { name: /^Expand/ }), hasTouch);
  }
  await expect(target).toHaveAttribute("aria-expanded", "true");
}

// Where a document's file sits in the data folder, relative to the folder
// that holds it.
async function expectFileIn(documentId: string, folderId: string) {
  await expect
    .poll(() => {
      const document = itemLocation(servicePort, documentId);
      const folder = itemLocation(servicePort, folderId);
      return folder && document?.slice(0, -1).join("/") === folder.join("/");
    })
    .toBe(true);
}

test("drags items between siblings and into folders, and refuses a folder dropped inside itself", async ({
  page,
  viewport,
  hasTouch,
}) => {
  test.skip(
    hasTouch,
    "Playwright cannot synthesize the long press that starts a native drag on a touch screen; the row menu test covers touch",
  );
  const context = { page, viewport, hasTouch };
  const titles = {
    source: unique("Drag source"),
    first: unique("Drag first"),
    second: unique("Drag second"),
    inner: unique("Drag inner"),
    target: unique("Drag target"),
  };
  await openWorkspace(page);
  const sourceId = await createItem(page, "folder", titles.source);
  const firstId = await createItem(page, "document", titles.first, sourceId);
  await createItem(page, "document", titles.second, sourceId);
  await createItem(page, "folder", titles.inner, sourceId);
  const targetId = await createItem(page, "folder", titles.target);
  await openWorkspace(page);
  let navigator = await showNavigator(context);
  await expand(navigator, titles.source, hasTouch);
  const rows = navigator.getByRole("row");
  await expect(rows).toContainText([titles.first, titles.second]);

  // The top edge of a row drops before it.
  await dragToMove(
    row(navigator, titles.second),
    row(navigator, titles.first),
    {
      x: 60,
      y: 2,
    },
  );
  await expect(rows).toContainText([
    titles.source,
    titles.second,
    titles.first,
    titles.inner,
    titles.target,
  ]);
  await expect(row(navigator, titles.second)).toHaveAttribute(
    "aria-level",
    "2",
  );

  // The middle of a folder drops inside it, last, and expands it.
  await dragToMove(row(navigator, titles.first), row(navigator, titles.target));
  await expect(row(navigator, titles.target)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(row(navigator, titles.first)).toHaveAttribute("aria-level", "2");
  await expect(rows).toContainText([titles.target, titles.first]);
  await expectFileIn(firstId, targetId);
  await expectAccessible(page);

  // A folder dropped on a folder inside it is refused before any request.
  const moves: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/position")) moves.push(request.url());
  });
  await drag(
    row(navigator, titles.source),
    row(navigator, titles.inner),
    undefined,
    { refused: true },
  );
  await expect(row(navigator, titles.source)).toHaveAttribute(
    "aria-level",
    "1",
  );
  await expect(row(navigator, titles.inner)).toHaveAttribute("aria-level", "2");
  expect(moves).toEqual([]);

  // The new order and places are the service's, so they survive a reload.
  await page.reload();
  navigator = await showNavigator(context);
  await expect(navigator.getByRole("row")).toContainText([
    titles.source,
    titles.second,
    titles.inner,
    titles.target,
    titles.first,
  ]);
});

test("moves items with the row menu instead of dragging, and restores the tree when a move fails", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const context = { page, viewport, hasTouch };
  const titles = {
    shelf: unique("Menu shelf"),
    alpha: unique("Menu alpha"),
    beta: unique("Menu beta"),
    gamma: unique("Menu gamma"),
    box: unique("Menu box"),
  };
  await openWorkspace(page);
  const shelfId = await createItem(page, "folder", titles.shelf);
  const alphaId = await createItem(page, "document", titles.alpha, shelfId);
  const betaId = await createItem(page, "document", titles.beta, shelfId);
  await createItem(page, "document", titles.gamma, shelfId);
  const boxId = await createItem(page, "folder", titles.box);
  await openWorkspace(page);
  let navigator = await showNavigator(context);
  await expand(navigator, titles.shelf, hasTouch);
  const rows = navigator.getByRole("row");

  // The first sibling cannot move up, and the last cannot move down.
  await press(
    row(navigator, titles.alpha).getByRole("button", { name: "More actions" }),
    hasTouch,
  );
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await rowCommand(context, row(navigator, titles.gamma), "Move up");
  await expect(rows).toContainText([titles.alpha, titles.gamma, titles.beta]);
  await rowCommand(context, row(navigator, titles.alpha), "Move down");
  await expect(rows).toContainText([titles.gamma, titles.alpha, titles.beta]);

  // Move to places an item last in another folder, or at the top level.
  await rowCommand(context, row(navigator, titles.beta), "Move to…");
  const dialog = page.getByRole("dialog", { name: `Move “${titles.beta}”` });
  await expect(
    dialog.getByRole("option", { name: `${titles.shelf} (current)` }),
  ).toHaveAttribute("aria-disabled", "true");
  await expectAccessible(page);
  await press(dialog.getByRole("option", { name: titles.box }), hasTouch);
  await press(dialog.getByRole("button", { name: "Move" }), hasTouch);
  await expect(dialog).toHaveCount(0);
  await expect(row(navigator, titles.box)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(rows).toContainText([titles.box, titles.beta]);
  await expectFileIn(betaId, boxId);

  await rowCommand(context, row(navigator, titles.alpha), "Move to…");
  await press(
    page.getByRole("option", { name: "Top level", exact: true }),
    hasTouch,
  );
  await press(page.getByRole("button", { name: "Move" }), hasTouch);
  await expect(row(navigator, titles.alpha)).toHaveAttribute("aria-level", "1");
  await expect.poll(() => itemLocation(servicePort, alphaId)?.length).toBe(1);

  // A move the service refuses returns the tree to the service's version.
  await page.route("**/api/v1/documents/*/position", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "Synthetic conflict for the test.",
        code: "conflict",
        errors: [],
      }),
    }),
  );
  await rowCommand(context, row(navigator, titles.beta), "Move to…");
  await press(page.getByRole("option", { name: titles.shelf }), hasTouch);
  await press(page.getByRole("button", { name: "Move" }), hasTouch);
  await expect(
    navigator.getByText(
      "Couldn't move the document. Its destination no longer exists or is inside it, so the navigator now shows the latest tree.",
    ),
  ).toBeVisible();
  await expect(rows).toContainText([titles.box, titles.beta]);
  await expect(row(navigator, titles.beta)).toHaveAttribute("aria-level", "2");
  await expectAccessible(page);
  await page.unrouteAll({ behavior: "wait" });

  await page.reload();
  navigator = await showNavigator(context);
  await expect(navigator.getByRole("row")).toContainText([
    titles.shelf,
    titles.gamma,
    titles.box,
    titles.beta,
    titles.alpha,
  ]);
});
