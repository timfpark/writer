import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

function assistantDocked(viewport: ViewportSize | null): boolean {
  return (viewport?.width ?? 0) >= 1200;
}

async function press(locator: Locator, hasTouch: boolean) {
  if (hasTouch) await locator.tap();
  else await locator.click();
}

function unique(label: string): string {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

function assistantToggle(page: Page): Locator {
  return page.getByRole("banner").getByRole("button", { name: /^Assistant/ });
}

function assistantPane(page: Page): Locator {
  return page.getByRole("complementary", { name: "Assistant" });
}

async function openAssistant(
  page: Page,
  viewport: ViewportSize | null,
  hasTouch: boolean,
) {
  const pane = assistantPane(page);
  if (!(await pane.isVisible())) {
    await press(assistantToggle(page), hasTouch);
  }
  await expect(pane).toBeVisible();
  if (!assistantDocked(viewport)) {
    await expect(page.getByRole("dialog", { name: "Assistant" })).toBeVisible();
  }
}

async function closeAssistant(
  page: Page,
  viewport: ViewportSize | null,
  hasTouch: boolean,
) {
  if (assistantDocked(viewport)) {
    await press(assistantToggle(page), hasTouch);
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(assistantPane(page)).toBeHidden();
}

async function openFindingsTab(
  page: Page,
  viewport: ViewportSize | null,
  hasTouch: boolean,
) {
  await openAssistant(page, viewport, hasTouch);
  const tab = assistantPane(page).getByRole("tab", { name: /^Findings/ });
  await press(tab, hasTouch);
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

const createdDocuments = new WeakMap<Page, string[]>();

async function createDocument(
  page: Page,
  title: string,
  markdown: string,
): Promise<string> {
  const documentId = crypto.randomUUID();
  const created = await page.request.post("/api/v1/documents", {
    data: { documentId, parentId: null, beforeId: null, title, markdown },
  });
  expect(created.status()).toBe(201);
  const list = createdDocuments.get(page) ?? [];
  list.push(documentId);
  createdDocuments.set(page, list);
  return documentId;
}

test.afterEach(async ({ page }) => {
  const ids = createdDocuments.get(page) ?? [];
  for (const id of ids) {
    await page.request.delete(`/api/v1/documents/${id}`).catch(() => {});
  }
});

test("starts no review during continuous typing, shows capped findings on pause, filters, What it read, collapsed badge, and Dismiss", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Findings Draft");
  const documentId = await createDocument(
    page,
    title,
    [
      "The harbor felt very dark beneath the low pier.",
      "Mara paused at the dock before she told her to wait.",
      "She never told the keeper where the brass key lay.",
      "Tom walked along the seawall and opens the rusted gate.",
      "Cold lantern light spilled from the lantern along the quay.",
    ].join("\n\n") + "\n",
  );

  let reviewRequests = 0;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/api/v1/pair-writer/reviews")
    ) {
      reviewRequests += 1;
    }
  });

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();

  // Collapse the assistant first to verify underlines and badge work while collapsed.
  if (assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }

  // Edit every paragraph continuously (faster than the 2.6 s pause window) so
  // all five paragraphs become dirty while zero review requests fire.
  const paragraphs = editor.locator("p");
  for (let i = 0; i < 5; i += 1) {
    await press(paragraphs.nth(i), hasTouch);
    await page.keyboard.press("End");
    await page.keyboard.type(" ", { delay: 30 });
    await page.waitForTimeout(350);
  }
  // Keep typing across > 3 s total without pausing 2.6 s -> zero review requests.
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.type("a");
    await page.waitForTimeout(450);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(450);
  }
  expect(reviewRequests).toBe(0);

  // Now pause past the quiet window: review runs and shows underlines within
  // ADR 0011's per-scene cap of 3 (one single scene holds 5 candidate issues).
  const underlines = editor.locator(".writer-finding-underline");
  await expect(underlines).toHaveCount(3, { timeout: 10_000 });
  expect(reviewRequests).toBe(1);

  // Collapsed toggle carries the active findings count badge and accessible name.
  await expect(assistantToggle(page)).toHaveAccessibleName(
    "Assistant, 3 findings",
  );
  await expectAccessible(page);

  // Clicking an underline opens the assistant pane directly to Findings with
  // that finding's card highlighted.
  await press(underlines.first(), hasTouch);
  await expect(assistantPane(page)).toBeVisible();
  await expect(
    assistantPane(page).getByRole("tab", { name: /^Findings/ }),
  ).toHaveAttribute("aria-selected", "true");
  const cards = assistantPane(page)
    .getByRole("list", { name: "Findings" })
    .locator(":scope > li");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute("data-selected", "true");
  await expectAccessible(page);

  // Category filters narrow the list cleanly.
  const questionsFilter = assistantPane(page).getByRole("button", {
    name: /^Questions/,
  });
  await press(questionsFilter, hasTouch);
  await expect(cards).toHaveCount(0);
  await expect(
    assistantPane(page).getByText("No findings in this category."),
  ).toBeVisible();
  await press(
    assistantPane(page).getByRole("button", { name: /^All/ }),
    hasTouch,
  );
  await expect(cards).toHaveCount(3);

  // What it read disclosure opens the exact reviewed passage read-only.
  const firstCard = cards.first();
  await press(firstCard.getByText("What it read"), hasTouch);
  await expect(
    firstCard.getByText(/Trigger: Short typing pause/),
  ).toBeVisible();
  await expect(
    firstCard.getByText(/Model: scripted-pair-writer/),
  ).toBeVisible();
  const sourceBtn = firstCard.getByRole("button", {
    name: new RegExp(title),
  });
  await press(sourceBtn, hasTouch);
  await expect(
    page.getByRole("button", { name: "Back to current draft" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();

  // Dismiss removes the finding and keeps that agent off the unchanged text.
  await openFindingsTab(page, viewport, hasTouch);
  await press(cards.first().getByRole("button", { name: "Dismiss" }), hasTouch);
  await expect(cards).toHaveCount(2);
  await expect(underlines).toHaveCount(2);
  await expectAccessible(page);
});

test("holds underlines when typing elsewhere and cancels review when editing the reviewed paragraph", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Trigger Draft");
  const documentId = await createDocument(
    page,
    title,
    "The harbor felt very dark tonight.\n\nCold rain ticked against the glass.\n",
  );

  // Hold each review response briefly so we can deterministically type while
  // the real service's review is in flight.
  const resolvers: Array<() => void> = [];
  let reviewStarts = 0;
  let abortedCount = 0;

  page.on("requestfailed", (req) => {
    if (req.url().includes("/api/v1/pair-writer/reviews")) {
      abortedCount += 1;
    }
  });

  await page.route("**/api/v1/pair-writer/reviews", async (route) => {
    reviewStarts += 1;
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      resolvers.push(resolve);
    });
    await route.fulfill({ response }).catch(() => {});
  });

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();
  const paragraphs = editor.locator("p");

  // Case A: edit paragraph 1, pause -> review #1 starts in flight.
  await press(paragraphs.nth(0), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" Still.");

  await expect.poll(() => reviewStarts, { timeout: 10_000 }).toBe(1);

  // While review #1 is in flight, type in paragraph 2 -> review #1 is NOT cancelled.
  await press(paragraphs.nth(1), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" Wind rose.");
  expect(abortedCount).toBe(0);

  // Release review #1 while we keep typing in paragraph 2 -> underlines stay HELD.
  resolvers.shift()?.();
  await page.waitForTimeout(300);
  await page.keyboard.type(" Fog.");
  await expect(editor.locator(".writer-finding-underline")).toHaveCount(0);

  // Pause -> held underlines from review #1 appear at the pause, and review #2 starts for paragraph 2.
  await expect(editor.locator(".writer-finding-underline")).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect.poll(() => reviewStarts, { timeout: 10_000 }).toBe(2);
  // Release review #2 so everything settles cleanly.
  resolvers.shift()?.();
  await page.waitForTimeout(200);

  // Case B: edit paragraph 1 again -> pause -> review #3 starts for paragraph 1.
  await press(paragraphs.nth(0), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" Very cold.");
  await expect.poll(() => reviewStarts, { timeout: 10_000 }).toBe(3);

  // Now type INSIDE paragraph 1 (the reviewed paragraph!) -> cancels review #3!
  await page.keyboard.type(" Now.");
  await expect
    .poll(() => abortedCount, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(1);
  // Drain any pending resolver for the cancelled request and verify the next pause reviews cleanly.
  resolvers.shift()?.();
  await expect.poll(() => reviewStarts, { timeout: 10_000 }).toBe(4);
  resolvers.shift()?.();
  await expect(editor.locator(".writer-finding-underline")).toHaveCount(1, {
    timeout: 10_000,
  });
  if (assistantDocked(viewport)) {
    await expectAccessible(page);
  }
});

test("marks edited passages Passage changed until next pause review and removes deleted passages quietly", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Lifecycle Draft");
  const documentId = await createDocument(
    page,
    title,
    "The harbor felt very dark beneath the low pier.\n\nShe never told anyone about the sealed letter.\n",
  );

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();

  // Touch both paragraphs and pause to get 2 findings (Weak prose + Open questions).
  const paragraphs = editor.locator("p");
  await press(paragraphs.nth(0), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await press(paragraphs.nth(1), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" ");

  const underlines = editor.locator(".writer-finding-underline");
  await expect(underlines).toHaveCount(2, { timeout: 10_000 });
  await openFindingsTab(page, viewport, hasTouch);
  const cards = assistantPane(page)
    .getByRole("list", { name: "Findings" })
    .locator(":scope > li");
  await expect(cards).toHaveCount(2);

  // Edit inside the first underlined passage ("very dark") -> underline drops
  // immediately and card shows "Passage changed" with ONLY Dismiss.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  const weakUnderline = editor
    .locator('.writer-finding-underline[data-finding-style="prose"]')
    .first();
  await press(weakUnderline, hasTouch);
  // On docked viewports clicking opened Findings; on overlaid close to edit.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
    await press(weakUnderline, hasTouch);
    await closeAssistant(page, viewport, hasTouch);
  }
  await page.keyboard.type("X");
  await expect(underlines).toHaveCount(1);

  await openFindingsTab(page, viewport, hasTouch);
  const changedCard = cards.filter({ hasText: "Passage changed" });
  await expect(changedCard).toHaveCount(1);
  await expect(
    changedCard.getByRole("button", { name: "Dismiss" }),
  ).toBeVisible();
  await expect(
    changedCard.getByRole("button", { name: /in Chat/ }),
  ).toHaveCount(0);
  await expectAccessible(page);

  // Pause -> next pause review replaces the changed card (fixing "very dark" ->
  // "very Xdark" or removing the intensifier; either way "Passage changed" clears).
  await expect(changedCard).toHaveCount(0, { timeout: 10_000 });

  // Now delete the second paragraph's flagged passage completely -> finding
  // removes quietly and live region announces removal.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  await editor.focus();
  await paragraphs.nth(1).evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = globalThis.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.keyboard.press("Backspace");

  await expect(
    page
      .locator('output[aria-live="polite"]')
      .filter({ hasText: /Removed .*finding.* deleted passage/i }),
  ).toHaveCount(1, { timeout: 5_000 });
  await expect(
    editor.locator('.writer-finding-underline[data-finding-style="question"]'),
  ).toHaveCount(0);
});

test("navigates findings with F8 and Shift+F8, focuses actions with F6, and hands off to Chat", async ({
  page,
  viewport,
  hasTouch,
}) => {
  test.skip(
    hasTouch,
    "F8 and F6 keyboard navigation applies to hardware keyboards",
  );
  const title = unique("Keyboard Findings");
  const documentId = await createDocument(
    page,
    title,
    "The harbor felt very dark beneath the low pier.\n\nShe never told the keeper where the brass key lay.\n",
  );

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();

  const paragraphs = editor.locator("p");
  await paragraphs.nth(0).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await paragraphs.nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");

  await expect(editor.locator(".writer-finding-underline")).toHaveCount(2, {
    timeout: 10_000,
  });

  // Press F8 -> moves to first finding (Weak prose), highlights card, announces agent and note.
  await page.keyboard.press("F8");
  const announcer = page
    .locator('output[aria-live="polite"]')
    .filter({ hasText: /Weak prose:/ });
  await expect(announcer).toHaveCount(1);

  // Press F8 again -> moves to second finding (Open questions).
  await page.keyboard.press("F8");
  await expect(
    page
      .locator('output[aria-live="polite"]')
      .filter({ hasText: /Open questions:/ }),
  ).toHaveCount(1);

  // Shift+F8 returns to the first finding.
  await page.keyboard.press("Shift+F8");
  await expect(announcer).toHaveCount(1);

  // On docked viewports, F6 moves focus straight into that highlighted card's actions.
  if (assistantDocked(viewport)) {
    await page.keyboard.press("F6");
    await expect(
      assistantPane(page).getByRole("button", { name: "Discuss in Chat" }),
    ).toBeFocused();
  }

  // Open Findings tab and activate "Answer in Chat" on the Open questions card.
  await openFindingsTab(page, viewport, hasTouch);
  const answerButton = assistantPane(page).getByRole("button", {
    name: "Answer in Chat",
  });
  await answerButton.click();

  // Chat tab opens with the finding pinned and focus in the message box.
  await expect(
    assistantPane(page).getByRole("tab", { name: /^Chat/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    assistantPane(page).getByRole("region", {
      name: "Pinned Open questions finding",
    }),
  ).toBeVisible();
  const messageBox = assistantPane(page).getByRole("textbox", {
    name: "Message the assistant",
  });
  await expect(messageBox).toBeFocused();
  await expectAccessible(page);

  // Send a message in the finding's thread and verify the reply arrives.
  await page.keyboard.type("She kept it hidden to protect her brother.");
  await page.keyboard.press("Enter");
  await expect(
    assistantPane(page)
      .getByRole("log", { name: "Conversation" })
      .getByText("What it read"),
  ).toBeVisible({ timeout: 10_000 });

  // Return to Findings and click Answer in Chat again -> resumes the SAME thread
  // (existing message stays visible; no duplicate thread created).
  await openFindingsTab(page, viewport, hasTouch);
  await assistantPane(page)
    .getByRole("button", { name: "Answer in Chat" })
    .click();
  await expect(
    assistantPane(page)
      .getByRole("log", { name: "Conversation" })
      .getByText("She kept it hidden to protect her brother.", { exact: true }),
  ).toBeVisible();
});

test("stops reviews while paused and while a Chat reply streams, keeping Chat available when paused", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Pause And Chat");
  const documentId = await createDocument(
    page,
    title,
    "The harbor felt very dark beneath the low pier.\n",
  );

  let reviewRequests = 0;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/api/v1/pair-writer/reviews")
    ) {
      reviewRequests += 1;
    }
  });

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  // Click Pause in the assistant header -> status reads "Paused by you".
  await press(
    assistantPane(page).getByRole("button", { name: "Pause" }),
    hasTouch,
  );
  await expect(assistantPane(page).getByText("Paused by you")).toBeVisible();
  await expectAccessible(page);

  // Type into the document and wait past the 2.6 s quiet window -> ZERO review requests leave.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  await press(editor.locator("p").first(), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" Very quiet.");
  await page.waitForTimeout(3_100);
  expect(reviewRequests).toBe(0);

  // Chat still answers while background review is paused!
  await openAssistant(page, viewport, hasTouch);
  await press(
    assistantPane(page).getByRole("tab", { name: /^Chat/ }),
    hasTouch,
  );
  await press(
    assistantPane(page).getByRole("button", {
      name: "Give me some ideas about how I can improve this text",
    }),
    hasTouch,
  );
  await expect(
    assistantPane(page)
      .getByRole("log", { name: "Conversation" })
      .getByText("What it read"),
  ).toBeVisible({ timeout: 10_000 });
  expect(reviewRequests).toBe(0);

  // Resume background review -> waiting change is reviewed after quiet window.
  await press(
    assistantPane(page).getByRole("button", { name: "Resume" }),
    hasTouch,
  );
  await expect(editor.locator(".writer-finding-underline")).toHaveCount(1, {
    timeout: 10_000,
  });
  const countAfterResume = reviewRequests;
  expect(countAfterResume).toBeGreaterThanOrEqual(1);

  // Now hold a Chat reply in flight, edit the document, and confirm ZERO review
  // requests leave while the Chat reply streams!
  const chatResolvers: Array<() => void> = [];
  await page.route("**/api/v1/pair-writer/replies", async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      chatResolvers.push(resolve);
    });
    await route.fulfill({ response }).catch(() => {});
  });

  await openAssistant(page, viewport, hasTouch);
  await press(
    assistantPane(page).getByRole("tab", { name: /^Chat/ }),
    hasTouch,
  );
  const box = assistantPane(page).getByRole("textbox", {
    name: "Message the assistant",
  });
  await press(box, hasTouch);
  await page.keyboard.type("How is the pacing here?");
  await page.keyboard.press("Enter");
  await expect(
    assistantPane(page).getByRole("button", { name: "Stop" }),
  ).toBeVisible();

  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  await press(editor.locator("p").first(), hasTouch);
  await page.keyboard.press("End");
  await page.keyboard.type(" Very cold wind.");
  // Wait past the 2.6 s pause window while Chat is still streaming -> ZERO review requests!
  await page.waitForTimeout(3_100);
  expect(reviewRequests).toBe(countAfterResume);

  chatResolvers.shift()?.();
  await expect
    .poll(() => reviewRequests, { timeout: 10_000 })
    .toBeGreaterThan(countAfterResume);
});
