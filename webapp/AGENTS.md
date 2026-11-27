---
title: Webapp Agent Guide
description: Purpose, boundaries, operational rules, governing decisions, and exact commands for coding agents working in webapp/
---

## Purpose and boundaries

`webapp/` is a client-rendered React 19 single-page application built with
Vite 8: Writer's editing workspace. Today it shows the workspace shell, a
header with the open document's editable title, save status, language picker,
and a keyboard shortcut reference above a collapsible navigator holding the
workspace tree, the writing region editing the open document with autosave,
and a collapsible assistant holding an in-memory conversation answered by a
client-side stub. Browser tests in `e2e/` drive it against a running service.
People start with [README.md](./README.md), which maps the source folders.

* Reach the service only through its HTTP API, using the client in
  [src/api/client.ts](./src/api/client.ts) and types generated from the
  committed [service/openapi.json](../service/openapi.json). Never import from
  `service/` or call `fetch` for the API directly.
* Use same-origin paths under `/api/`; the development server proxies them to
  the service. Never put a service URL in the browser bundle or add a `VITE_`
  variable for one.
* Add no server rendering, framework server, or second server process.
  Routing, styling, components, server-state caching, and browser storage
  follow [ADR 0007](../docs/adrs/0007-webapp-interface.md), and the editor,
  its Markdown bridge, and autosave follow
  [ADR 0008](../docs/adrs/0008-editor.md);
  authentication waits for the story and ADR that choose it.

## Operational rules

### API client

* Never edit [src/api/generated/](./src/api/generated/) by hand. After
  `service/openapi.json` changes, run `npm run api:generate` and commit the
  result with the contract.
* Import `client` and schema types such as `Health` and `Problem` from
  [client.ts](./src/api/client.ts). Export a new named schema type there
  rather than reaching into the generated file from components.
* Treat an error body as a `Problem` only when the response's content type is
  `application/problem+json`; a proxy or network failure has no such body.
  Branch on `code`, never on `title` or `detail` text.
* Responses are not validated at run time; rely on the generated types and the
  gate.

### Interface

* Style each component with a `Component.module.css` beside it, using only
  the semantic tokens in [src/styles/tokens.css](./src/styles/tokens.css),
  never primitive palette values. Never commit or edit the generated
  `*.module.css.d.ts` declarations; `npm run typecheck` regenerates them.
* After changing a color token, keep
  [tokens.test.ts](./src/styles/tokens.test.ts) passing in both themes; add
  any new foreground and background pair to its table.
* Build buttons, menus, popovers, overlays, and tooltips on
  `react-aria-components`, never a second component library or a hand-built
  pattern. Icons come from `lucide-react`, marked `aria-hidden`, and every
  icon-only button has an accessible name.
* Add routes to the code-based tree in [src/router.tsx](./src/router.tsx);
  never add TanStack Router's Vite plugin, generated route files, or
  devtools. Components read server state through the query options in
  [src/api/queries.ts](./src/api/queries.ts) and never write query keys.
* Change the tree only through `useWorkspaceChange` in
  [workspaceChanges.ts](./src/api/workspaceChanges.ts), which queues changes
  in one mutation scope, and read it through `useWorkspaceTree`, which
  applies pending changes with the pure functions in
  [workspaceTree.ts](./src/api/workspaceTree.ts), as ADR 0007's server state
  section decides.
* Keep small preferences in `localStorage` under keys starting `writer.`,
  through [preferences.ts](./src/shell/preferences.ts), falling back to the
  default when a value is missing or unreadable.
* Match and label every keyboard shortcut through
  [shortcuts.ts](./src/shell/shortcuts.ts), and list each one in the
  reference in [ShortcutsDialog.tsx](./src/shell/ShortcutsDialog.tsx) and in
  [README.md](./README.md)'s control tables. `F6` and the focus a closing
  pane returns rely on [regions.ts](./src/shell/regions.ts): keep
  `data-region` on each pane and the writing region, and `data-focus-target`
  on the one control in each that takes focus.
* Get the assistant's replies only through the `Assistant` interface in
  [conversation.ts](./src/workspace/conversation.ts), whose default is the
  client-side stub. Keep the conversation in `WorkspaceShell`, never in the
  pane, because an overlaid pane unmounts while it is closed.
* Size the docked panes, the writing region, and the header's matching
  columns from the same layout tokens in
  [tokens.css](./src/styles/tokens.css) (`--page-width`, `--page-inset`, the
  pane widths and maximums, and `--control-size`), and change a column's flex
  sizing in [Pane.module.css](./src/shell/Pane.module.css) or
  [WorkspaceShell.module.css](./src/shell/WorkspaceShell.module.css) together
  with [Header.module.css](./src/shell/Header.module.css), so the title stays
  over the page's text.
* Keep both breakpoints, 60 and 75 rem, and the touch rules keyed to
  `(hover: none)` and `(pointer: coarse)` as ADR 0007's responsive layout
  sets, so the shell works on iPad in both orientations.
* Import [src/styles/global.css](./src/styles/global.css) first in
  [main.tsx](./src/main.tsx), so component modules override its base rules.
* Request nothing from another origin: fonts come from the Fontsource
  packages, and the build emits their licenses beside them.

### Editor and saving

* Keep the editor, its extensions, and the Markdown bridge in
  [src/editor/](./src/editor/), reached only through the lazy import in
  [views.tsx](./src/workspace/views.tsx), so they stay in their own chunk.
  Modules outside `src/editor/` import nothing from it but types.
* Parse with the editor's own schema (`editor.schema`); nodes from another
  schema instance never compare equal, which silently turns off byte
  preservation.
* Keep the corpus, repair, and seeded random tests in
  [src/editor/markdown/](./src/editor/markdown/) passing with every bridge
  change, and add a synthetic corpus document for any newly handled
  construct. Corpus files are test data and are not formatted or linted.
* Save content only through the document's `DocumentSaver`, obtained from
  the `SaveManager` in [src/saving/](./src/saving/); never call the content
  `PUT` elsewhere. The saver makes its tree changes, such as a conflict copy,
  through `makeWorkspaceChange`, in the same queue as the navigator's.
* Keep `npm run budget` passing: the editor chunk within 160 KB and an open
  document's JavaScript within 400 KB, gzipped.

### Code and tests

* Keep `tsc`, Oxlint, and Prettier clean; fix findings rather than disabling
  rules. Lint and formatting skip the generated client, but `tsc` checks it.
* Place Vitest tests next to the code as `*.test.ts` or `*.test.tsx`. Replace
  `fetch` with `vi.stubGlobal`; they never reach a real service or the network.
  jsdom has no `matchMedia`, so panes dock unless a test stubs it, as
  [App.test.tsx](./src/App.test.tsx) does for narrow viewports.
* Use synthetic prose in tests and fixtures, never a real manuscript.
* Vitest runs only `src/**/*.test.{ts,tsx}`. Browser tests live in `e2e/` as
  `*.spec.ts`, import `test` and `expect` from
  [e2e/fixtures.ts](./e2e/fixtures.ts), never from `@playwright/test`
  directly, so the same-origin guard applies, and call `expectAccessible` in
  each distinct state they reach.
* Write browser tests to pass in every project: find elements by role and
  name, tap where `hasTouch` is set, and skip a layout or input a test does
  not apply to with a reason, using ADR 0007's breakpoints.
* Browser tests share one service and data folder per run. Create the
  synthetic items a test needs, with titles unique to it, and never assume an
  empty workspace or another test's data. Find or edit an item's file outside
  Writer only through [e2e/outside.js](./e2e/outside.js).

### Toolchain and dependencies

* Change `engines.node` in [package.json](./package.json) and the Node.js
  `version` in [devcontainer.json](../.devcontainer/devcontainer.json)
  together, and update setup docs in [README.md](./README.md) and the root
  [README.md](../README.md) in the same change. `tools/check` refuses any other
  Node.js version.
* Install only through [.npmrc](./.npmrc), which sets the registry proxy,
  `save-exact`, `engine-strict`, and `ignore-scripts`. If a dependency needs an
  install script, name it here and run its step explicitly rather than enabling
  scripts. No current dependency needs one.
* Dependabot proposes webapp updates only after a 7-day cooldown, as ADR 0007
  decides; keep it in [dependabot.yml](../.github/dependabot.yml).
* Change `@playwright/test` in [package.json](./package.json) and the
  `playwright` feature's `version` in
  [devcontainer.json](../.devcontainer/devcontainer.json) together; the
  browsers belong to one release, and `npm run e2e:browsers` exits 2 when
  they differ.
* Stay on TypeScript 6.0 and keep the `overrides` entry for
  `openapi-typescript` until it supports TypeScript 7, as
  [ADR 0003](../docs/adrs/0003-webapp-architecture.md#typescript) decides.
* Pick versions with no known advisory; CI's dependency review fails on any
  vulnerability, in any scope and severity. Commit
  [package-lock.json](./package-lock.json) with every dependency change.

## Governing decisions

Consult these when changing architecture, dependencies, or conventions:

* [ADR 0001](../docs/adrs/0001-monorepo-structure.md): repository layout,
  subsystem boundaries, the validation gate, and toolchain pinning
* [ADR 0003](../docs/adrs/0003-webapp-architecture.md): Vite, the generated
  client, the `/api/` development proxy, and the quality toolchain
* [ADR 0004](../docs/adrs/0004-api-conventions.md): versioning, naming,
  problem details, operation IDs and tags, and SSE framing
* [ADR 0005](../docs/adrs/0005-workspace-model.md): folders and documents,
  client-generated identifiers, the workspace operations, and autosave
  conflict recovery
* [ADR 0007](../docs/adrs/0007-webapp-interface.md): typed CSS Modules and
  design tokens, themes and contrast targets, typefaces, React Aria
  Components, drag and drop, routes, server-state caching, unsaved-text
  storage, icons, and supported browsers
* [ADR 0008](../docs/adrs/0008-editor.md): Tiptap and the Markdown bridge,
  the supported subset and canonical form, raw source for other Markdown,
  the round-trip guarantee, input rules, undo history, autosave timing and
  flush events, document styles, the bundle budget, and responsiveness
  targets
* [ADR 0009](../docs/adrs/0009-browser-tests.md): Playwright and axe-core
  browser tests in `e2e/`, the projects, the servers and data folder
  each run starts, the same-origin guard, and the `browser` gate phase
* [ADR 0011](../docs/adrs/0011-background-agents-ux.md): the fifteen
  first-wave background agents, always-on subtle passage underlines with
  density caps, the collapsed assistant badge, the three-tab assistant pane
  with expandable Reference views, three-level session recaps, global pause,
  and battery status
* [ADR 0012](../docs/adrs/0012-pair-writing-experience.md): advice-only
  pair-writing journeys, chat threads in the assistant pane, the selection
  chip and what the next turn reads, `Passage changed` findings, underlines
  that wait for the next pause, the single working or unread dot, `F8`
  navigation, `What it read` sources, and setup and failure states

## Commands

Run npm commands from `webapp/` with Node.js 26.13.1:

```bash
npm ci                                   # install the locked dependencies
npm run dev                              # serve on 127.0.0.1:5180, proxying /api/ to 127.0.0.1:8888
WRITER_SERVICE_PORT=8889 npm run dev     # proxy /api/ to a service on another port
npm run api:generate                     # regenerate src/api/generated/schema.d.ts
npm run api:check                        # fail if the generated client is stale
npm run format                           # format with Prettier
npm run lint                             # Oxlint, type-aware, warnings denied
npm run typecheck                        # CSS Module declarations, then tsc without emitting
npm run test                             # Vitest once
npm run build                            # production build in dist/
npm run budget                           # fail if dist/ exceeds ADR 0008's bundle budget
npm run e2e:browsers                     # exit 2 unless every Playwright browser launches
npm run e2e                              # browser tests against a service on 8898, served on 5198
npm run e2e -- --project=webkit          # one project: chromium, webkit, ipad-portrait, ipad-landscape
npm run e2e -- --project=responsiveness --no-deps  # ADR 0008's timing test alone
npx playwright install chromium webkit  # on a host, install the locked release's browsers
npm config get registry                  # expect the packagefeedproxy.microsoft.io proxy
```

Before reporting work complete, run `tools/check` from the repository root.
Its `webapp` phase runs `npm ci --include=dev --no-audit --no-fund`, then
`npm run api:check`, `format:check`, `lint`, `typecheck`, `test`, `build`,
and `budget`.
Its `browser` phase then runs `npm run e2e:browsers` and `npm run e2e`.
