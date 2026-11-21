// Exits 2, naming the fix, unless every browser the browser tests use launches.
// Launching, rather than looking for files, also catches a browser installed
// for another Playwright release or missing its system libraries.
import { chromium, webkit } from "@playwright/test";
import { readFileSync } from "node:fs";
import process from "node:process";

const { devDependencies } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const version = devDependencies["@playwright/test"];

const failures = [];
for (const browserType of [chromium, webkit]) {
  try {
    const browser = await browserType.launch();
    await browser.close();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push(`${browserType.name()}: ${reason.split("\n")[0]}`);
  }
}

if (failures.length > 0) {
  console.error(
    [
      `e2e:browsers: prerequisite missing: the Playwright ${version} browsers must launch`,
      ...failures.map((failure) => `  ${failure}`),
      "In the development container, rebuild it, and keep the playwright feature's version in .devcontainer/devcontainer.json equal to @playwright/test in webapp/package.json.",
      "On a host, run in webapp/: npx playwright install chromium webkit (with --with-deps on Linux).",
    ].join("\n"),
  );
  process.exit(2);
}
console.log(`e2e:browsers: Playwright ${version} browsers launch`);
