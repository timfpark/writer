import { defineConfig, devices } from "@playwright/test";
import { servicePort, webappPort } from "./e2e/ports";

const baseURL = `http://127.0.0.1:${webappPort}`;

// Tests that measure ADR 0008's responsiveness targets.
const timed = /responsiveness\.spec\.ts$/;

// ADR 0007's iPad range runs from 744 px wide in portrait, where both panes
// open over the writing region, to landscape, where the navigator docks.
const iPadPortrait = {
  ...devices["iPad Pro 11"],
  viewport: { width: 744, height: 1133 },
};

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  forbidOnly: true,
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    // Token transitions would otherwise let the accessibility check measure
    // colors partway through a theme change.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    ...[
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
      { name: "ipad-portrait", use: iPadPortrait },
      { name: "ipad-landscape", use: { ...devices["iPad Pro 11 landscape"] } },
    ].map((project) => ({ ...project, testIgnore: timed })),
    // Timing targets hold only on an otherwise idle machine, so these tests
    // run alone, after every other project has finished.
    {
      name: "responsiveness",
      use: { ...devices["Desktop Chrome"] },
      testMatch: timed,
      dependencies: ["chromium", "webkit", "ipad-portrait", "ipad-landscape"],
    },
  ],
  webServer: [
    {
      // The first run compiles the service, which can take minutes.
      command: "node scripts/e2e-service.js",
      url: `http://127.0.0.1:${servicePort}/api/v1/health`,
      env: { WRITER_PORT: String(servicePort) },
      timeout: 300_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      command: `npm run dev -- --port ${webappPort} --mode e2e`,
      url: baseURL,
      env: { WRITER_SERVICE_PORT: String(servicePort) },
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
