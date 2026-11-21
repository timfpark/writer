import { expect, test } from "./fixtures";

declare global {
  interface Window {
    writerTiming?: { keystrokes: number[]; serializations: number[] };
  }
}

// ADR 0008's responsiveness targets, on a synthetic manuscript at ADR 0005's
// 1 MiB content limit, with the CPU throttled 4×.
const contentLimit = 1024 * 1024;
const editableWithin = 1_000;
const keystrokeP95 = 50;
const serializeWithin = 25;

// A small seeded generator, so every run types into the same manuscript.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const words = (
  "harbor lantern tide gull rope quay fog mast sail anchor keeper beacon " +
  "salt shore wave stone gray morning evening drift current signal cliff " +
  "the a of and to in over under along beside slowly quietly again"
).split(" ");

// Chapters of 80 to 150 word paragraphs carrying emphasis, strong emphasis,
// and a link, with occasional block quotes and lists, just under the limit.
function manuscript(): string {
  const next = random(23);
  const pick = () => words[Math.floor(next() * words.length)] ?? "tide";
  const blocks: string[] = [];
  let size = 0;
  const add = (block: string) => {
    blocks.push(block);
    size += new TextEncoder().encode(block).length + 2;
  };
  for (let chapter = 1; ; chapter++) {
    if (size >= contentLimit - 4_096) break;
    add(`# Chapter ${chapter}`);
    for (let paragraph = 0; paragraph < 12; paragraph++) {
      if (size >= contentLimit - 4_096) break;
      const count = 80 + Math.floor(next() * 70);
      const text = Array.from({ length: count }, pick);
      text[3] = `*${text[3] ?? "tide"}*`;
      text[9] = `**${text[9] ?? "tide"}**`;
      text[15] = `[${text[15] ?? "tide"}](https://example.com/${chapter})`;
      add(`${text.join(" ")}.`);
      if (paragraph % 5 === 4) add(`> ${pick()} ${pick()} ${pick()}.`);
      if (paragraph % 7 === 6) add(`- ${pick()}\n- ${pick()}\n- ${pick()}`);
    }
  }
  return `${blocks.join("\n\n")}\n`;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

test("edits a 1 MiB document within the responsiveness targets", async ({
  page,
  browserName,
}) => {
  // playwright.config.ts runs this file only in the responsiveness project,
  // in desktop Chromium, alone.
  test.skip(
    browserName !== "chromium",
    "CPU throttling needs the Chrome DevTools Protocol",
  );
  test.setTimeout(180_000);

  const title = `Long manuscript ${crypto.randomUUID().slice(0, 8)}`;
  const markdown = manuscript();
  expect(new TextEncoder().encode(markdown).length).toBeLessThanOrEqual(
    contentLimit,
  );
  const documentId = crypto.randomUUID();
  const created = await page.request.post("/api/v1/documents", {
    data: { documentId, parentId: null, beforeId: null, title, markdown },
  });
  expect(created.status()).toBe(201);

  // Opening a small document first loads the editor's chunk, so the
  // measurement starts from the manuscript's content alone.
  const warmId = crypto.randomUUID();
  const warmTitle = `Warm up ${warmId.slice(0, 8)}`;
  await page.request.post("/api/v1/documents", {
    data: {
      documentId: warmId,
      parentId: null,
      beforeId: null,
      title: warmTitle,
      markdown: "Calm water.\n",
    },
  });
  await page.goto(`/documents/${warmId}`);
  await expect(page.getByRole("textbox", { name: warmTitle })).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page
    .getByRole("navigation", { name: "Navigator" })
    .getByRole("row", { name: title, exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: title, exact: true });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => performance.getEntriesByName("writer:editable").length >= 2,
  );
  const editable = await page.evaluate((id) => {
    const marks = performance.getEntriesByName("writer:editable");
    const content = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.endsWith(`/documents/${id}/content`));
    const arrived = content.at(-1);
    const mark = marks.at(-1);
    if (!arrived || !mark || !("responseEnd" in arrived)) return Infinity;
    return mark.startTime - Number(arrived.responseEnd);
  }, documentId);
  expect(editable, "milliseconds from content to editable").toBeLessThan(
    editableWithin,
  );

  // Measures each keystroke from keydown to the frame after it, and each
  // serialization for a save.
  await page.evaluate(() => {
    const state = {
      keystrokes: [] as number[],
      serializations: [] as number[],
    };
    window.writerTiming = state;
    document.addEventListener(
      "keydown",
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() =>
          state.keystrokes.push(performance.now() - start),
        );
      },
      { capture: true },
    );
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "writer:serialize") {
          state.serializations.push(entry.duration);
        }
      }
    }).observe({ entryTypes: ["measure"] });
  });

  const middle = editor.locator("p").nth(400);
  await middle.scrollIntoViewIfNeeded();
  await middle.click();
  await page.keyboard.press("End");
  // Faster than any writer types, but each key waits for the one before to
  // be sent, so the measurement is not of keys queued behind one another.
  await page.keyboard.type(
    " The keeper climbed the stair again and trimmed the lamp before the long night came in over the water.",
    { delay: 30 },
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  const { keystrokes, serializations } = await page.evaluate(
    () => window.writerTiming ?? { keystrokes: [], serializations: [] },
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  expect(keystrokes.length).toBeGreaterThanOrEqual(100);
  expect(
    percentile(keystrokes, 0.95),
    "95th percentile keystroke in milliseconds",
  ).toBeLessThan(keystrokeP95);
  expect(serializations.length).toBeGreaterThan(0);
  expect(
    Math.max(...serializations),
    "slowest serialization in milliseconds",
  ).toBeLessThanOrEqual(serializeWithin);
});
