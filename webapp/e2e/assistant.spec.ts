import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

// ADR 0007's breakpoints, 60 and 75 rem, in CSS pixels at the 16 px root.
function navigatorDocked(viewport: ViewportSize | null): boolean {
  return (viewport?.width ?? 0) >= 960;
}

function assistantDocked(viewport: ViewportSize | null): boolean {
  return (viewport?.width ?? 0) >= 1200;
}

// Taps on touch screens and clicks elsewhere, as a writer would.
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

function transcript(page: Page): Locator {
  return assistantPane(page).getByRole("log", { name: "Conversation" });
}

function messageBox(page: Page): Locator {
  return assistantPane(page).getByRole("textbox", {
    name: "Message the assistant",
  });
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

test("answers about an open document with quote links, What it read, and no-document state", async ({
  page,
  viewport,
  hasTouch,
}) => {
  // No-document state asks the writer to open one and disables Send.
  const health = page.waitForResponse("**/api/v1/health");
  await page.goto("/");
  await health;
  await expect(page.getByText("No document is open")).toBeVisible();
  await openAssistant(page, viewport, hasTouch);
  await expect(
    assistantPane(page).getByText(/Open a document in the navigator to chat/i),
  ).toBeVisible();
  await expect(
    assistantPane(page).getByRole("button", { name: "Send" }),
  ).toBeDisabled();
  await expectAccessible(page);

  const sentence1 = "The lantern swayed above the harbor stones.";
  const sentence2 =
    "Cold rain ticked against the glass while the ferry waited.";
  const title = unique("Harbor Draft");
  const documentId = await createDocument(
    page,
    title,
    `${sentence1}\n\n${sentence2}\n`,
  );

  await page.goto(`/documents/${documentId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  // Empty thread shows the reading summary and the three starter prompts.
  await expect(
    assistantPane(page).getByText(`${title} · whole · 17 words`),
  ).toBeVisible();
  const starter = assistantPane(page).getByRole("button", {
    name: "Give me some ideas about how I can improve this text",
  });
  await expect(starter).toBeVisible();
  await expectAccessible(page);

  // Sending shows Stop right away and streams verbatim quotes from the service.
  await press(starter, hasTouch);
  const quoteButton = transcript(page).getByRole("button", {
    name: `“${sentence1}”`,
  });
  await expect(quoteButton).toBeVisible({ timeout: 10_000 });
  const whatItRead = transcript(page).getByText("What it read");
  await expect(whatItRead).toBeVisible({ timeout: 10_000 });
  await expectAccessible(page);

  // Activating a quote link highlights the passage in the editor (and closes
  // an overlaid assistant pane so the passage is visible).
  await press(quoteButton, hasTouch);
  await expect(editor.locator(".writer-quote-highlight")).toContainText(
    sentence1,
  );
  if (!assistantDocked(viewport)) {
    await openAssistant(page, viewport, hasTouch);
  }

  // What it read opens the exact document source read-only, and Back / Escape return.
  await press(whatItRead, hasTouch);
  await expect(
    transcript(page).getByText("Model: scripted-pair-writer"),
  ).toBeVisible();
  const sourceButton = transcript(page).getByRole("button", {
    name: new RegExp(`${title} · whole · 17 words`),
  });
  await press(sourceButton, hasTouch);
  const backButton = page.getByRole("button", {
    name: "Back to current draft",
  });
  await expect(backButton).toBeVisible();
  await expect(page.locator("[data-readonly-source]")).toContainText(sentence1);
  await expectAccessible(page);
  await press(backButton, hasTouch);
  await expect(editor).toBeVisible();

  // Also returns on Escape.
  if (!assistantDocked(viewport)) {
    await openAssistant(page, viewport, hasTouch);
    await press(whatItRead, hasTouch);
  }
  await press(sourceButton, hasTouch);
  await expect(backButton).toBeVisible();
  if (!assistantDocked(viewport)) {
    await expect(assistantPane(page)).toBeHidden();
  }
  await page.keyboard.press("Escape");
  await expect(backButton).toBeHidden();
  await expect(editor).toBeVisible();
});

test("mirrors editor selection, ignores with x, and adds another document with + Context", async ({
  page,
  viewport,
  hasTouch,
}) => {
  test.skip(
    !assistantDocked(viewport),
    "selection mirroring while Chat has focus applies when the editor stays visible beside Chat",
  );
  const titleA = unique("Quay Scene");
  const titleB = unique("Tide Notes");
  const selectedLine = "Mara checked the rusted padlock twice before dawn.";
  const docA = await createDocument(
    page,
    titleA,
    `${selectedLine}\n\nThe foghorn sounded past the breakwater.\n`,
  );
  await createDocument(
    page,
    titleB,
    "The harbor ferry stopped running after the November gale.\n",
  );

  await page.goto(`/documents/${docA}`);
  const editor = page.getByRole("textbox", { name: titleA });
  await expect(editor).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  // Select the first paragraph via triple-click / keyboard so ProseMirror updates selection.
  const firstParagraph = editor.locator("p").first();
  await firstParagraph.click({ clickCount: 3 });

  const selectionChip = assistantPane(page).getByText(/Selection: “Mara/);
  await expect(selectionChip).toBeVisible();

  // Moving focus into Chat keeps the selection highlighted in the editor.
  await messageBox(page).click();
  await expect(editor.locator(".writer-inactive-selection")).toBeVisible();

  // Ignoring the selection removes the chip for the next message.
  await press(
    assistantPane(page).getByRole("button", {
      name: "Ignore selection for next message",
    }),
    hasTouch,
  );
  await expect(selectionChip).toBeHidden();

  // Reselecting restores the chip.
  await firstParagraph.click();
  await firstParagraph.click({ clickCount: 3 });
  await expect(selectionChip).toBeVisible();

  // + Context adds the second document and updates total words.
  await press(
    assistantPane(page).getByRole("button", { name: "Context" }),
    hasTouch,
  );
  const contextDialog = page.getByRole("dialog", {
    name: "Add documents to context",
  });
  await expect(contextDialog).toBeVisible();
  await press(
    contextDialog.getByRole("button", { name: new RegExp(titleB) }),
    hasTouch,
  );
  await expect(contextDialog).toBeHidden();
  await expect(assistantPane(page).getByText(/Total 23 words/)).toBeVisible();

  // Send with Shift+Enter newline + Enter; reply quotes the selection and cites Doc B.
  await messageBox(page).click();
  await page.keyboard.type("Check this opening line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("against the notes.");
  await page.keyboard.press("Enter");

  await expect(
    transcript(page).getByText("Check this opening line\nagainst the notes."),
  ).toBeVisible();
  const whatItRead = transcript(page).getByText("What it read");
  await expect(whatItRead).toBeVisible({ timeout: 10_000 });
  await expect(
    transcript(page).getByRole("button", { name: `“${selectedLine}”` }),
  ).toBeVisible();
  await press(whatItRead, hasTouch);
  await expect(
    transcript(page).getByRole("button", { name: new RegExp(titleB) }),
  ).toBeVisible();
});

test("manages document threads, switching, inline delete, and deleted document history", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const titleA = unique("Chapter One");
  const titleB = unique("Chapter Two");
  const docA = await createDocument(
    page,
    titleA,
    "The keeper wound the brass clock before sunset.\n",
  );
  await createDocument(
    page,
    titleB,
    "Salt spray coated the rail along the outer jetty.\n",
  );

  await page.goto(`/documents/${docA}`);
  await expect(page.getByRole("textbox", { name: titleA })).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  // Start thread on Doc A.
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Pacing note for chapter one");
  await page.keyboard.press("Enter");
  await expect(transcript(page).getByText("What it read")).toBeVisible({
    timeout: 10_000,
  });

  async function openFromNavigator(title: string) {
    if (!assistantDocked(viewport) && (await assistantPane(page).isVisible())) {
      await closeAssistant(page, viewport, hasTouch);
    }
    if (!navigatorDocked(viewport)) {
      await press(
        page.getByRole("banner").getByRole("button", { name: "Navigator" }),
        hasTouch,
      );
    }
    const nav = page.getByRole("navigation", { name: "Navigator" });
    await press(nav.getByRole("row", { name: title, exact: true }), hasTouch);
    await expect(page.getByRole("textbox", { name: title })).toBeVisible();
  }

  // Opening Doc B in-app starts a new thread for Doc B.
  await openFromNavigator(titleB);
  await openAssistant(page, viewport, hasTouch);
  await expect(
    assistantPane(page).getByRole("heading", { name: "New chat", level: 2 }),
  ).toBeVisible();
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Imagery note for chapter two");
  await page.keyboard.press("Enter");
  await expect(transcript(page).getByText("What it read")).toBeVisible({
    timeout: 10_000,
  });

  // Switching back to Doc A reopens Doc A's thread.
  await openFromNavigator(titleA);
  await openAssistant(page, viewport, hasTouch);
  await expect(
    transcript(page).getByText("Pacing note for chapter one", { exact: true }),
  ).toBeVisible();

  // Back arrow opens the full-pane Chats list with This document, All chats, and New chat.
  await press(
    assistantPane(page).getByRole("button", { name: /^Chats/ }),
    hasTouch,
  );
  await expect(
    assistantPane(page).getByRole("heading", { name: "Chats", level: 2 }),
  ).toBeVisible();
  await expect(
    assistantPane(page).getByRole("button", { name: "New chat" }),
  ).toBeVisible();
  await expect(assistantPane(page).getByText("This document")).toBeVisible();
  await expect(assistantPane(page).getByText("All chats")).toBeVisible();
  await expectAccessible(page);

  // Picking Doc B's thread from All chats offers Open document.
  await press(
    assistantPane(page).getByRole("button", {
      name: new RegExp(`Imagery note for chapter two.*${titleB}`),
    }),
    hasTouch,
  );
  const openDocButton = assistantPane(page).getByRole("button", {
    name: "Open document",
  });
  await expect(openDocButton).toBeVisible();
  await press(openDocButton, hasTouch);
  await expect(page.getByRole("textbox", { name: titleB })).toBeVisible();

  // New chat from the Chats list and inline-confirmed Delete from the thread header.
  await openAssistant(page, viewport, hasTouch);
  await press(
    assistantPane(page).getByRole("button", { name: /^Chats/ }),
    hasTouch,
  );
  await press(
    assistantPane(page).getByRole("button", { name: "New chat" }),
    hasTouch,
  );
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Temporary thread to delete");
  await page.keyboard.press("Enter");
  await expect(transcript(page).getByText("What it read")).toBeVisible({
    timeout: 10_000,
  });
  await press(
    assistantPane(page).getByRole("button", { name: "Delete chat" }),
    hasTouch,
  );
  await press(
    assistantPane(page).getByRole("button", { name: "Confirm delete" }),
    hasTouch,
  );
  await expect(
    assistantPane(page).getByRole("heading", { name: "New chat", level: 2 }),
  ).toBeVisible();

  // Deleting Doc B through the Navigator keeps its thread marked under All chats.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  if (!navigatorDocked(viewport)) {
    await press(
      page.getByRole("banner").getByRole("button", { name: "Navigator" }),
      hasTouch,
    );
  }
  const nav = page.getByRole("navigation", { name: "Navigator" });
  const docBRow = nav.getByRole("row", { name: titleB, exact: true });
  await expect(docBRow).toBeVisible();
  await press(docBRow.getByRole("button", { name: "More actions" }), hasTouch);
  await press(page.getByRole("menuitem", { name: /Delete/ }), hasTouch);
  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toContainText("All chats");
  await press(confirmDialog.getByRole("button", { name: "Delete" }), hasTouch);
  await expect(page.getByText("No document is open")).toBeVisible();

  await openAssistant(page, viewport, hasTouch);
  await press(
    assistantPane(page).getByRole("button", { name: /^Chats/ }),
    hasTouch,
  );
  await expect(
    assistantPane(page).getByText(`${titleB} · Deleted document`),
  ).toBeVisible();
});

test("stops a streaming reply and keeps streaming into its thread while collapsed or switched", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Streaming Draft");
  const docId = await createDocument(
    page,
    title,
    [
      "The ferry engine idled against the timber pilings while fog gathered.",
      "Clara counted the stacked crates along the slipway twice.",
      "Far out beyond the point, the bell buoy rang a slow double beat.",
    ].join("\n\n") + "\n",
  );

  await page.goto(`/documents/${docId}`);
  await expect(page.getByRole("textbox", { name: title })).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  // Stop keeps whatever arrived and marks the turn Stopped.
  await press(messageBox(page), hasTouch);
  await page.keyboard.type(
    "Give me some ideas about how I can improve this text",
  );
  await page.keyboard.press("Enter");
  const stopButton = assistantPane(page).getByRole("button", { name: "Stop" });
  await expect(stopButton).toBeVisible();
  await press(stopButton, hasTouch);
  await expect(
    transcript(page).getByText("Stopped", { exact: true }),
  ).toBeVisible();

  // Start a new thread, send a reply, and collapse the pane while it streams.
  await press(
    assistantPane(page).getByRole("button", { name: "New", exact: true }),
    hasTouch,
  );
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Background stream check");
  await page.keyboard.press("Enter");
  await expect(stopButton).toBeVisible();

  await closeAssistant(page, viewport, hasTouch);
  // Toggle reports unread reply once the stream finishes while collapsed.
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Assistant (unread reply)" }),
  ).toBeVisible({ timeout: 10_000 });
  await expectAccessible(page);

  await openAssistant(page, viewport, hasTouch);
  await expect(transcript(page).getByText("What it read")).toBeVisible();
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Assistant", exact: true }),
  ).toBeVisible();

  // Start another reply and immediately switch to + New: Send is disabled until it ends, and it arrives unread.
  await press(
    assistantPane(page).getByRole("button", { name: "New", exact: true }),
    hasTouch,
  );
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Switch thread mid-stream");
  await page.keyboard.press("Enter");
  await expect(stopButton).toBeVisible();
  await press(
    assistantPane(page).getByRole("button", { name: "New", exact: true }),
    hasTouch,
  );
  await expect(
    assistantPane(page).getByRole("button", { name: "Send" }),
  ).toBeDisabled();

  // Wait for completion, then return to the Chats list and verify the unread badge on that thread.
  await expect(assistantPane(page).getByText(/Replying in/)).toBeHidden({
    timeout: 10_000,
  });
  const backToChats = assistantPane(page).getByRole("button", {
    name: /Chats \(unread reply in another chat\)/,
  });
  await expect(backToChats).toBeVisible();
  await press(backToChats, hasTouch);
  const unreadEntry = assistantPane(page)
    .getByRole("button", {
      name: /Switch thread mid-stream.*\(unread reply\)/,
    })
    .first();
  await expect(unreadEntry).toBeVisible();
  await press(unreadEntry, hasTouch);
  await expect(transcript(page).getByText("What it read")).toBeVisible();
});

test("revives a thread after editing with View text then and Continuing divider", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Revived Draft");
  const original = "The brass bell rang once across the quiet cove.";
  const docId = await createDocument(page, title, `${original}\n`);

  await page.goto(`/documents/${docId}`);
  const editor = page.getByRole("textbox", { name: title });
  await expect(editor).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  await press(messageBox(page), hasTouch);
  await page.keyboard.type(
    "Give me some ideas about how I can improve this text",
  );
  await page.keyboard.press("Enter");
  const quoteButton = transcript(page).getByRole("button", {
    name: `“${original}”`,
  });
  await expect(quoteButton).toBeVisible({ timeout: 10_000 });
  await expect(transcript(page).getByText("What it read")).toBeVisible({
    timeout: 10_000,
  });

  // Edit the quoted sentence itself so it no longer matches verbatim.
  if (!assistantDocked(viewport)) {
    await closeAssistant(page, viewport, hasTouch);
  }
  await editor.click();
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type("harbor.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toBeVisible();

  await openAssistant(page, viewport, hasTouch);
  await expect(
    assistantPane(page).getByText("Document edited since this chat"),
  ).toBeVisible({ timeout: 5_000 });
  // Changed quote stays plain text instead of a button.
  await expect(quoteButton).toHaveCount(0);
  await expect(transcript(page)).toContainText(`“${original}”`);

  // View text then opens the original snapshot read-only.
  await press(
    assistantPane(page).getByRole("button", { name: "View text then" }),
    hasTouch,
  );
  await expect(page.locator("[data-readonly-source]")).toHaveText(original);
  await page.keyboard.press("Escape");

  // Sending a follow-up adds the Continuing against the current draft divider.
  await openAssistant(page, viewport, hasTouch);
  await press(messageBox(page), hasTouch);
  await page.keyboard.type("How does the revised line read?");
  await page.keyboard.press("Enter");
  await expect(
    transcript(page).getByText("Continuing against the current draft"),
  ).toBeVisible();
  await expect(transcript(page).getByText("What it read")).toHaveCount(2, {
    timeout: 10_000,
  });
});

test("windows a document past the 19,000-word limit around the cursor", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Very Long Draft");
  const paragraph =
    "The harbor keeper checked the lantern glass and listened to the steady tide below the stone quay. ";
  // ~20,400 words: safely above ADR 0012's 19,000-word limit.
  const longMarkdown = `${paragraph.repeat(1_200)}\n`;
  const docId = await createDocument(page, title, longMarkdown);

  await page.goto(`/documents/${docId}`);
  await expect(page.getByRole("textbox", { name: title })).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  await expect(
    assistantPane(page).getByText(`${title} · around cursor · 19,000 words`),
  ).toBeVisible();

  await press(messageBox(page), hasTouch);
  await page.keyboard.type("How does this section pace?");
  await page.keyboard.press("Enter");
  const whatItRead = transcript(page).getByText("What it read");
  await expect(whatItRead).toBeVisible({ timeout: 10_000 });
  await press(whatItRead, hasTouch);
  await expect(
    transcript(page).getByRole("button", {
      name: new RegExp(`${title} · around cursor · 19,000 words`),
    }),
  ).toBeVisible();
});

test("shows setup notice until ready without reload, and retries a mid-stream failure", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const title = unique("Recovery Draft");
  const docId = await createDocument(
    page,
    title,
    "The harbor gate creaked open before sunrise.\n",
  );

  // Simulate an unavailable model on the readiness endpoint.
  await page.route("**/api/v1/pair-writer", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: false,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: "modelMissing",
        detail: "Model scripted-pair-writer is not installed.",
      }),
    }),
  );

  await page.goto(`/documents/${docId}`);
  await expect(page.getByRole("textbox", { name: title })).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  await expect(
    assistantPane(page).getByText(
      /Model “scripted-pair-writer” is not available/,
    ),
  ).toBeVisible();
  await expect(
    assistantPane(page).getByText("service/README.md"),
  ).toBeVisible();
  await expectAccessible(page);

  await press(messageBox(page), hasTouch);
  await page.keyboard.type("Keep this question ready");
  await expect(
    assistantPane(page).getByRole("button", { name: "Send" }),
  ).toBeDisabled();

  // Restore real readiness and reopen the pane: notice clears without reload and draft stays.
  await page.unroute("**/api/v1/pair-writer");
  await closeAssistant(page, viewport, hasTouch);
  await openAssistant(page, viewport, hasTouch);
  await expect(
    assistantPane(page).getByText(
      /Model “scripted-pair-writer” is not available/,
    ),
  ).toBeHidden();
  await expect(messageBox(page)).toHaveValue("Keep this question ready");
  await expect(
    assistantPane(page).getByRole("button", { name: "Send" }),
  ).toBeEnabled();

  // Simulate a mid-stream SSE failure once, keeping partial text and showing Retry.
  await page.route("**/api/v1/pair-writer/replies", (route) => {
    const sse = [
      'event: delta\ndata: {"text":"1. Partial note before failure "}\n\n',
      'event: error\ndata: {"type":"about:blank","title":"Bad Gateway","status":502,"detail":"The pair writer stopped responding before the reply finished.","code":"upstreamFailed","errors":[]}\n\n',
    ].join("");
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse,
    });
  });

  await press(
    assistantPane(page).getByRole("button", { name: "Send" }),
    hasTouch,
  );
  await expect(
    transcript(page).getByText("1. Partial note before failure"),
  ).toBeVisible();
  const retryButton = transcript(page).getByRole("button", { name: "Retry" });
  await expect(retryButton).toBeVisible();
  await expectAccessible(page);

  // Unroute so Retry hits the real scripted service and succeeds.
  await page.unroute("**/api/v1/pair-writer/replies");
  await press(retryButton, hasTouch);
  await expect(
    transcript(page).getByRole("button", {
      name: "“The harbor gate creaked open before sunrise.”",
    }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(transcript(page).getByText("What it read")).toBeVisible({
    timeout: 10_000,
  });
});
