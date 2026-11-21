import { AxeBuilder } from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

// Fails any test whose page requests something outside the webapp's origin,
// and stops the request, so runs need no network beyond loopback and the
// webapp's rule against other origins holds in real browsers.
export const test = base.extend<{ sameOriginOnly: void }>({
  sameOriginOnly: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error("playwright.config.ts must set baseURL");
      const origin = new URL(baseURL).origin;
      const blocked: string[] = [];
      await page.route(
        (url) => url.origin !== origin,
        (route) => {
          blocked.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await use();
      expect(blocked, "requests outside the webapp's origin").toEqual([]);
    },
    { auto: true },
  ],
});

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Checks the page as rendered against WCAG 2.2 AA in both themes, including
// contrast composed from the real fonts, layout, and overlapping surfaces.
export async function expectAccessible(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const { violations } = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();
    expect(
      violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target.join(" ")),
      })),
      `accessibility violations in the ${colorScheme} theme`,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });
}

export { expect };
