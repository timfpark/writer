import type { Locator, Page, ViewportSize } from "@playwright/test";
import { expect, expectAccessible, test } from "./fixtures";

// ADR 0007's assistant breakpoint, 75 rem, in CSS pixels at the 16 px root.
function docked(viewport: ViewportSize | null): boolean {
  return (viewport?.width ?? 0) >= 1200;
}

// Taps on touch screens and clicks elsewhere, as a writer would.
async function press(locator: Locator, hasTouch: boolean) {
  if (hasTouch) await locator.tap();
  else await locator.click();
}

function assistantToggle(page: Page): Locator {
  return page
    .getByRole("banner")
    .getByRole("button", { name: "Assistant", exact: true });
}

function transcript(page: Page): Locator {
  return page.getByRole("log", { name: "Conversation" });
}

async function openAssistant(
  page: Page,
  viewport: ViewportSize | null,
  hasTouch: boolean,
) {
  if (!docked(viewport)) await press(assistantToggle(page), hasTouch);
  await expect(
    page.getByRole("complementary", { name: "Assistant" }),
  ).toBeVisible();
}

test("answers a message from the stub without sending a request", async ({
  page,
  viewport,
  hasTouch,
}) => {
  const health = page.waitForResponse("**/api/v1/health");
  await page.goto("/");
  await health;
  await expect(page.getByText("No document is open")).toBeVisible();
  await openAssistant(page, viewport, hasTouch);

  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const box = page.getByRole("textbox", { name: "Message the assistant" });
  await press(box, hasTouch);
  await page.keyboard.type("Does the opening line land?");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Be honest.");
  await page.keyboard.press("Enter");

  const messages = transcript(page).getByRole("listitem");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText(
    "Does the opening line land?\nBe honest.",
  );
  await expect(messages.nth(1)).toContainText("I'm not connected yet.");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  expect(requests).toEqual([]);
  await expectAccessible(page);

  // The transcript stays through closing and reopening the pane.
  if (docked(viewport)) await press(assistantToggle(page), hasTouch);
  else await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Assistant" }),
  ).toBeHidden();
  await press(assistantToggle(page), hasTouch);
  await expect(transcript(page).getByRole("listitem")).toHaveCount(2);

  // A reload clears it.
  await page.reload();
  await expect(page.getByText("No document is open")).toBeVisible();
  await openAssistant(page, viewport, hasTouch);
  await expect(transcript(page).getByRole("listitem")).toHaveCount(0);
});
