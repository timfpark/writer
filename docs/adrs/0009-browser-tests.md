---
title: "ADR 0009: Browser end-to-end and accessibility tests"
description: Selects Playwright Test with axe-core for browser end-to-end and automated accessibility tests in webapp/e2e/, run on Chromium and WebKit on desktop and WebKit with touch at iPad sizes, against the development server and a real service on a fresh data folder, as a browser phase of tools/check with browsers pinned in the development container
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - webapp
  - repository
keywords:
  - adr
  - webapp
  - playwright
  - axe-core
  - accessibility
  - end-to-end tests
  - webkit
  - ipad
estimated_reading_time: 10
---

## Status

Accepted on 2026-11-20.

This record settles the browser end-to-end and automated accessibility
testing that [ADR 0003](./0003-webapp-architecture.md#follow-up-decisions)
deferred, the engines and the accessibility checker that
[ADR 0007](./0007-webapp-interface.md#follow-up-decisions) left to backlog
21, and the location of the cross-subsystem end-to-end tests that
[ADR 0001](./0001-monorepo-structure.md#artifact-locations) left to the first
story needing them.

Amended on 2026-11-21 to drop the `firefox` project, when
[ADR 0007](./0007-webapp-interface.md#supported-browsers) dropped Firefox from
the supported browsers. The development container no longer installs it.

Amended on 2026-11-21 for the writing surface, which backlog 23 built. A
fifth project, `responsiveness`, runs
[ADR 0008's responsiveness test](./0008-editor.md#responsiveness) alone in
desktop Chromium after the other four finish, because timing targets hold
only on an otherwise idle machine. ADR 0008 sets its targets on development
hardware with the CPU throttled 4×; CI runners are no particular hardware, so
where `CI` is set the test runs unthrottled against the same targets and
ADR 0008's unthrottled 33 ms for keystrokes. The development server runs in Vite's
`e2e` mode, which serves packages' production exports as the build does, so
the test measures what ships rather than development builds with assertions.
The data folder is named after the service's port, so a test can edit a
document's file outside Writer.

## Decision summary

* Write browser tests with Playwright Test, `@playwright/test` 1.65.1, in
  `webapp/e2e/` as `*.spec.ts` files, configured by
  `webapp/playwright.config.ts`, and run them with `npm run e2e`.
* Check accessibility with axe-core through `@axe-core/playwright` 4.14.0,
  against WCAG 2.2 AA in the light and dark themes, on the page as rendered.
* Run every test on four projects: Chromium and WebKit at a 1280 by 720
  desktop size, and WebKit with touch at iPad sizes in portrait
  (744 px wide) and landscape (1194 px wide). Run the responsiveness test
  alone in a fifth, after them.
* Start a real service on a new, empty data folder in the system's temporary
  directory, and the webapp's development server proxying to it, for each
  run, on loopback ports 8898 and 5198. Remove the folder when the service
  stops.
* Fail any test whose page requests another origin, so runs need no network
  beyond loopback.
* Run the tests in a `browser` phase of `tools/check`, after `webapp`, which
  exits 2 when a browser cannot launch. CI runs it through the existing
  `tools/check` job.
* Pin the browsers in the development container with a local feature,
  `.devcontainer/playwright/`, whose version equals `@playwright/test`. On a
  host, `npx playwright install` provides them.

## Context

Vitest with jsdom tests the webapp's components, as
[ADR 0003](./0003-webapp-architecture.md#quality-checks) decides, and never
reaches a real service. jsdom has no layout, media queries, focus behavior
tied to rendering, or real input events. The workspace shell already depends
on all of them: panes dock or open over the writing region by viewport width,
touch rules key to `(pointer: coarse)`, and React Aria handles taps, focus,
and dismissal. The navigator, writing surface, and drag-and-drop stories
(backlogs 22, 23, and 24) need tree editing, rich-text input, dragging, and
autosave verified the way a writer uses them, which a simulated DOM does not
do faithfully.

[ADR 0007](./0007-webapp-interface.md#supported-browsers) supports desktop
Chrome, Edge, and Safari, and Safari on iPadOS, and verifies iPad
layouts in browser tests at iPad sizes with touch until Writer is served to an
iPad. Its contrast test checks token pairs; it asks for a checker that
measures contrast as composed on the page.

Since the workspace storage stories (backlogs 18 and 19), the service stores
the workspace in a data folder and serves it through the workspace API, so a
browser test can drive the webapp against the real service with synthetic
data.

A prototype in this repository installed the selected packages through the
npm proxy, with no install scripts. It installed the browsers for Debian 13
in the development container with their system libraries, and ran the first
test file on all five projects. Thirteen applicable tests passed in about 10
seconds once the service was built. Replacing the pane toggle's handler with
a no-op failed six tests across every project, removing the close button's
accessible name failed the accessibility check with axe's `button-name` rule,
and adding a script from another origin failed every test that loaded it.

## Decision drivers

* Real engines for each supported browser family, including WebKit at iPad
  sizes with touch
* Tests that drive the webapp the way a writer does, against the real service
  with synthetic data, coupled to it only through HTTP
* Contrast and other WCAG checks on the page as rendered, in both themes
* One gate, `tools/check`, with the same result in the development container,
  on a host, and in CI
* No network access at test time beyond loopback, and installs only through
  the registry proxies
* Few dependencies, exact versions, and no package install scripts

## Considered options

### Test runner

1. Playwright Test drives Chromium and WebKit through one API, with
   device descriptors for iPad viewports, touch, and mobile WebKit. It starts
   and stops the servers a run needs, waits on locators by role, retains a
   trace of a failed test, and has no install script.
2. Vitest browser mode, through `@vitest/browser-playwright` 5.1.0, runs
   component tests in a real browser using Playwright as its provider. It
   reuses the Vite configuration, but renders components in isolation inside
   Vitest's own page, so it neither loads the webapp through the development
   server nor reaches the service. It would suit component tests that jsdom
   cannot run faithfully, which no story needs yet.
3. Cypress and WebdriverIO drive real browsers too, but Cypress's WebKit
   support is experimental and WebdriverIO needs a driver per browser, with no
   built-in iPad emulation.

### Accessibility checker

1. axe-core through `@axe-core/playwright` runs in the page under test, so it
   measures contrast from computed styles, real fonts, and overlapping
   surfaces, and reports each violated rule with its WCAG tags and targets.
2. Lighthouse and Pa11y run axe-core or similar rules in their own Chromium
   session against a URL, so they cannot check a state a test reached, such
   as an open pane, or run in WebKit.
3. Playwright's ARIA snapshots record the accessibility tree but check no
   WCAG rule, including contrast.

### Engines

1. Chromium and WebKit on desktop, plus WebKit with touch at iPad sizes,
   cover every supported browser family. Branded Chrome and Edge share
   Chromium's engine, and Playwright's WebKit builds track Safari's engine.
2. Chromium only would run fastest, but would miss Safari rendering, and
   could not emulate iPad touch on WebKit.

### Location

1. `webapp/e2e/` keeps the tests beside the code they drive, in the webapp's
   npm project, so they share its lockfile, TypeScript, lint, and formatting.
   The service is started as a process and reached only over HTTP.
2. A top-level `e2e/` subsystem would need its own manifest, lockfile,
   `.npmrc`, toolchain checks, and guides, duplicating the webapp's
   dependencies, with no code of its own to justify them.

### Where the gate runs them

1. A `browser` phase of `tools/check` gives every contributor and coding agent
   the same result locally and in CI, as
   [ADR 0001](./0001-monorepo-structure.md#validation-gate) requires of the
   gate.
2. A separate CI job wired into `CI result` would keep `tools/check` faster,
   but a change could pass locally and fail only in CI.

### Browser installation

1. A local development container feature installs the browsers and their
   system libraries at image build, after Node.js, so test runs download
   nothing. Its version option pins the release.
2. A `postCreateCommand` would install them on every container creation,
   downloading browsers outside the image build.
3. Playwright's own container image as the base would bring an Ubuntu base,
   replacing the pinned Debian image that fixes Python, Bash, and Git.

## Decision

### Packages

Add `@playwright/test` 1.65.1 and `@axe-core/playwright` 4.14.0, which
brings `axe-core` 4.14.0, to the webapp's development dependencies. None runs
an install script. Upgrading within these choices is a dependency change, not
a new decision, but a `@playwright/test` upgrade needs new browsers, so its
change also updates the development container's `playwright` feature to the
same version.

### Location and layout

| Path                              | Holds                                                                          |
|-----------------------------------|--------------------------------------------------------------------------------|
| `webapp/e2e/*.spec.ts`            | Browser tests, one file per area of the workspace                              |
| `webapp/e2e/fixtures.ts`          | The extended `test`, the same-origin guard, and `expectAccessible`             |
| `webapp/playwright.config.ts`     | Projects, ports, reduced motion, traces, and the two servers each run starts   |
| `webapp/scripts/e2e-service.js`   | Starts the service on a new data folder and removes the folder when it stops   |
| `webapp/scripts/e2e-browsers.js`  | Exits 2, naming the fix, unless every browser launches                         |
| `webapp/test-results/`            | Traces and failure output, ignored by Git, Prettier, and Oxlint                |

Vitest runs only `src/**/*.test.{ts,tsx}`, so it never loads a browser test.
`tsc`, Oxlint, and Prettier check `e2e/` and the configuration like any other
webapp source.

### Projects

| Project          | Engine   | Viewport    | Input           | Panes at this width                               |
|------------------|----------|-------------|-----------------|---------------------------------------------------|
| `chromium`       | Chromium | 1280 by 720 | Mouse           | Both docked                                       |
| `webkit`         | WebKit   | 1280 by 720 | Mouse           | Both docked                                       |
| `ipad-portrait`  | WebKit   | 744 by 1133 | Touch, mobile   | Both open over the writing region                 |
| `ipad-landscape` | WebKit   | 1194 by 834 | Touch, mobile   | Navigator docked, assistant over the writing area |
| `responsiveness` | Chromium | 1280 by 720 | Mouse           | Both docked                                       |

The iPad projects use Playwright's iPad Pro 11 descriptors, with the portrait
width narrowed to 744 px, the narrowest iPad ADR 0007 names. Together the
projects cover each row of ADR 0007's responsive layout table. A test that
applies only to some layouts or inputs skips the others with a reason, and
taps rather than clicks where the project has touch. In the prototype,
WebKit's touch emulation matched `(pointer: coarse)`, so the touch target
rules are testable.

Every run emulates `prefers-reduced-motion: reduce`, which sets
`--duration-fast` to 0, so the accessibility check never measures a color
partway through a transition. Tests run fully parallel, with no retries, and
`test.only` fails the run. The `responsiveness` project runs only
`responsiveness.spec.ts`, which the other projects skip, and depends on all
four, so it starts once they finish and its CPU-throttled timings share the
machine with nothing else.

### Servers and data

Each run starts two servers, and stops both when it ends:

1. The service, through `scripts/e2e-service.js`, which creates an empty data
   folder named after its port, `writer-e2e-8898`, in the system's temporary
   directory, replacing any left by an interrupted run, runs
   `cargo run --locked -p writer-server` in `service/` with `WRITER_PORT=8898`
   and `WRITER_DATA_DIR` set to it, forwards `SIGINT` and `SIGTERM`, and
   removes the folder when the service exits. Playwright waits for
   `/api/v1/health`, allowing 5 minutes for a first build.
2. The development server, through `npm run dev -- --port 5198 --mode e2e`,
   with `WRITER_SERVICE_PORT=8898`, so the browser reaches the service only
   through the `/api/` proxy as it does in development. The `e2e` mode
   resolves packages' `production` exports, as the build does, and keeps its
   pre-bundled dependencies apart from the development server's.

The ports differ from 8888 and 5180, so a run never collides with
development servers, and neither is forwarded from the container. A port
already in use fails the run rather than reusing another process. Tests share
one service within a run, so each test creates only items with synthetic
titles it owns and never depends on another test's data.

### Network

An automatic fixture aborts and records every request to an origin other than
the development server's, and fails the test listing them. Runs therefore need
no network beyond loopback, and the webapp's rule against requesting other
origins holds in real browsers.

### Accessibility checks

`expectAccessible(page)` runs axe-core with the `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa`, and `wcag22aa` tags in the light theme and then the
dark theme, and fails on any violation, listing each rule and its targets.
Tests call it in each distinct state they reach, such as with panes collapsed
or a pane open over the writing region. Vitest's token contrast test stays:
it checks the stricter writing-surface targets that axe-core's AA rules do
not.

### Gate

The `browser` phase of `tools/check` runs in `webapp/` after the `webapp`
phase, using its install:

```bash
npm run e2e:browsers
npm run e2e
```

`e2e:browsers` launches each engine headless. When one fails to launch,
because its build is missing, belongs to another Playwright release, or lacks
system libraries, it exits 2, naming the fix, and the tests do not run.
`tools/check` reports that phase as a missing prerequisite. It exits 1 when
any phase fails, otherwise 2 when any phase lacks a prerequisite, and 0 when
every phase passes. CI's `tools/check` job therefore covers the browser tests,
and a failing test fails `CI result`.

### Development container and hosts

The local feature in `.devcontainer/playwright/` installs, after the node
feature, the headless Chromium shell and WebKit for its `version`
option, with their system libraries, into `/ms-playwright`, and sets
`PLAYWRIGHT_BROWSERS_PATH` to it. `npx` resolves Playwright through the npm
registry proxy; the browser builds come from Playwright's download host at
image build time only. The prototype's install took 857 MB on arm64.

On a host, `npx playwright install chromium webkit` in `webapp/`
installs the browsers for the locked release, with `--with-deps` on Linux to
add system libraries.

## Consequences

Positive outcomes:

* The shell, and each later story's behavior, are verified in every supported
  engine against the real service, including iPad layouts with touch.
* Contrast and other WCAG checks cover the page as composed, in both themes
  and in states only a test can reach.
* A browser test that fails, a browser that cannot launch, and a request to
  another origin each give a distinct, named result in the same gate locally
  and in CI.
* Each run starts from an empty workspace and leaves no data behind.

Trade-offs and risks:

* The development container image grows by about 860 MB, and building it
  downloads the browsers, lengthening CI's image build.
* `tools/check` takes longer, by about 10 seconds today, and more as stories
  add tests. ADR 0001's ten-minute trigger for selective checks applies.
* Playwright's WebKit is not Safari, and touch emulation is not an iPad; real
  devices remain unverified until a hosting decision serves Writer to them.
* `@playwright/test` and the container feature pin one version in two places.
  An upgrade to one alone makes `tools/check` exit 2 until the other matches.
* Tests share one service per run, so a test that assumed an empty workspace
  would depend on test order.
* axe-core finds only what automated rules can. Backlog 26 added browser
  tests of keyboard-only paths, and screen reader checks stay manual, as the
  webapp README's screen reader check records.

## Revisit triggers

* A full `tools/check` run in CI regularly exceeds ten minutes: run the
  browser phase in its own CI job wired into `CI result`, or shard it.
* A component needs a real browser but not the service, such as the editor's
  input handling: add Vitest browser mode for those component tests.
* Writer is served to an iPad or another device: add tests on real devices or
  a device cloud.
* Tests need isolated workspaces: start a service per worker, each on its own
  port and data folder.
* Playwright stops publishing builds for the container's Debian release:
  revisit the base image or the browser source.

## References

* [Playwright Test](https://playwright.dev/docs/intro)
* [Playwright web server](https://playwright.dev/docs/test-webserver)
* [Playwright emulation and device descriptors](https://playwright.dev/docs/emulation)
* [Playwright browsers and `PLAYWRIGHT_BROWSERS_PATH`](https://playwright.dev/docs/browsers)
* [Vitest browser mode](https://vitest.dev/guide/browser/)
* [axe-core](https://github.com/dequelabs/axe-core)
* [axe-core rule tags](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#axe-core-tags)
* [Accessibility testing with Playwright](https://playwright.dev/docs/accessibility-testing)
* [Dev Container features](https://containers.dev/implementors/features/)
* [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
