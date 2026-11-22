---
title: Writer webapp
description: How to set up, run, configure, and check the Writer webapp, a React single-page writing workspace that calls the service through a generated API client
author: Tim Park
ms.date: 2026-11-21
ms.topic: overview
keywords:
  - webapp
  - react
  - vite
  - openapi
  - css modules
  - react aria
---

## Overview

The webapp is Writer's client, a React single-page application built with
Vite. It shows the writing workspace: a header bar above a navigator on the
left, the writing region in the center, and an assistant on the right. Both
side panes collapse, so the writing region can take the whole width. The
navigator shows the workspace's folders and documents as a tree, the writing
region edits the open document as formatted text that saves itself, and the
assistant holds a conversation answered by a stub until the pair-writing
agent joins.
Coding agents start with [AGENTS.md](./AGENTS.md); the architecture is
recorded in [ADR 0003](../docs/adrs/0003-webapp-architecture.md), the API
conventions in [ADR 0004](../docs/adrs/0004-api-conventions.md), the
interface foundation in [ADR 0007](../docs/adrs/0007-webapp-interface.md), the
editor and its Markdown in [ADR 0008](../docs/adrs/0008-editor.md), and the
browser tests in [ADR 0009](../docs/adrs/0009-browser-tests.md).

| Path                                                         | Responsibility                                                              |
|--------------------------------------------------------------|-----------------------------------------------------------------------------|
| [src/main.tsx](./src/main.tsx)                               | Startup: global styles, the query client, and the router                    |
| [src/router.tsx](./src/router.tsx)                           | The typed route tree for `/`, `/documents/$documentId`, and not-found paths |
| [src/shell/](./src/shell/)                                   | The header, the side panes, their shortcuts, and stored pane preferences    |
| [src/workspace/](./src/workspace/)                           | What the writing region and the side panes show                             |
| [src/editor/](./src/editor/)                                 | The editor, its schema, and the link dialog, loaded as their own chunk      |
| [src/editor/markdown/](./src/editor/markdown/)               | The Markdown bridge, its round-trip corpus, and its tests                   |
| [src/saving/](./src/saving/)                                 | Autosave, retries, conflict recovery, and unsaved text in IndexedDB         |
| [src/styles/](./src/styles/)                                 | Design tokens for both themes, global styles, and the token contrast test   |
| [src/api/client.ts](./src/api/client.ts)                     | The only module that calls the service, through openapi-fetch               |
| [src/api/queries.ts](./src/api/queries.ts)                   | The query client, retry policy, and query options components read through   |
| [src/api/workspaceChanges.ts](./src/api/workspaceChanges.ts) | Tree changes queued in order, and the tree with pending changes applied     |
| [src/api/workspaceTree.ts](./src/api/workspaceTree.ts)       | Pure functions that apply tree changes and nest the pre-order item list     |
| [src/api/generated/](./src/api/generated/)                   | Types generated from [service/openapi.json](../service/openapi.json)        |
| [scripts/api-check.js](./scripts/api-check.js)               | Fails when the generated types differ from the contract                     |
| [scripts/bundle-budget.js](./scripts/bundle-budget.js)       | Fails when the built JavaScript exceeds ADR 0008's bundle budget            |
| [vite.config.ts](./vite.config.ts)                           | Development server, `/api/` proxy, CSS Modules, font licenses, and Vitest   |
| [e2e/](./e2e/)                                               | Playwright browser and accessibility tests against a running service        |
| [playwright.config.ts](./playwright.config.ts)               | Browser test projects, ports, and the servers each run starts               |
| [scripts/e2e-service.js](./scripts/e2e-service.js)           | Runs the service on a new data folder for a browser test run                |
| [e2e/outside.js](./e2e/outside.js)                           | Finds and edits items' files in that data folder, as another program would  |
| [e2e/environment.js](./e2e/environment.js)                   | Whether a browser test run is in CI                                         |
| [scripts/e2e-browsers.js](./scripts/e2e-browsers.js)         | Exits 2 unless every browser the tests use launches                         |

The generated types are committed. Never edit them by hand; regenerate them
as [Checks](#checks) describes. Each `Component.module.css` gets a
`Component.module.css.d.ts` declaration beside it, which the development
server, build, tests, and `npm run typecheck` write and Git ignores.

### The workspace

| Control                           | Effect                                                                |
|-----------------------------------|-----------------------------------------------------------------------|
| Navigator button or `Mod+\`       | Shows or hides the navigator                                          |
| Assistant button or `Mod+Shift+\` | Shows or hides the assistant                                          |
| Profile button                    | Opens the profile menu for the one local writer, who needs no sign-in |

The navigator lists folders and documents in the service's order, indented
one level per folder with guide lines:

| Control                                    | Effect                                                             |
|--------------------------------------------|--------------------------------------------------------------------|
| New document or New folder in its toolbar  | Creates an item at the top level, starting in inline rename        |
| A folder row's hover buttons or menu       | Creates a document or folder inside it                             |
| A row's More actions button or right click | Renames, moves, deletes, or expands or collapses everything inside |
| Dragging a row or its drag handle          | Moves the item before or after a row, or into a folder             |
| Move up or Move down in a row's menu       | Swaps the item with its previous or next sibling                   |
| Move to… in a row's menu                   | Moves the item last into a folder or the top level that you choose |
| Collapse all folders                       | Collapses every folder                                             |
| Selecting a document                       | Opens it in the writing region and highlights its row              |

In the tree, the arrow keys move between rows and expand or collapse
folders, `Home` and `End` jump to the first and last row, typing finds a
title, and `Enter` opens a document or toggles a folder. In inline rename,
`Enter` keeps the title and `Escape` discards it. Deleting asks first and
says how many items a folder deletion removes. While dragging, a line shows
where the item will land and an outlined folder shows it will go inside;
holding over a collapsed folder expands it, the pane scrolls near its edges,
and a folder cannot be dropped inside itself. The menu's move commands reach
every place a drag can, without dragging, and the drag handle also starts a
drag from the keyboard. Changes appear at once; when
the service refuses one, the tree returns to the service's version and a
notice above it says why. Expanded folders are kept in `localStorage` under
`writer.navigator.expanded`, and opening a document by URL expands the
folders around it.

`Mod` is Command on macOS and iPadOS and Control elsewhere. In a window 75 rem
(1,200 px at the default text size) or wider, both panes dock beside the
writing region, each growing into the room the page leaves, up to 24 rem for
the navigator and 32 rem for the assistant. From 60 to 75 rem the assistant
opens over the writing region,
and below 60 rem both do, so the region keeps its width on an iPad in either
orientation. A pane over the writing region closes on `Escape`, a tap outside
it, its toggle in the header, or a change of route. Whether each docked pane is
collapsed is kept in `localStorage` under `writer.navigator.collapsed` and
`writer.assistant.collapsed`, so it survives a reload.

The header's title slot shows the open document's title, or Writer's name at
`/`, starting where the writing page's text starts whichever panes are open.
When the service cannot be reached, the writing region says so and
offers to try again.

The assistant shows a conversation with the pair writer above a message box
that grows with its text.
`Enter` or the Send button sends, and `Shift+Enter` starts a new line. Until
the pair-writing agent arrives, a stub in the browser answers that the
assistant is not connected yet, so a message sends no request. The
conversation lives only in memory: it stays while the pane closes and
reopens, and a reload clears it.

### Writing

The writing region edits the open document in Newsreader on a centered page,
hiding the Markdown it is stored as. Typing Markdown, such as `##` and a space or
`**bold**`, formats as it goes, and `Backspace` straight after undoes the
formatting. While the caret is in or beside formatted text, the Markdown
markers around that text, such as `*`, `**`, or a link's `[` and
`](address)`, show in a muted color and hide again when the caret leaves. Each
marker has a caret stop on either side, and text typed on its inner side is
formatted while text on its outer side is not. Formatting never continues
onto a new line.
Markdown outside the
[supported subset](../docs/adrs/0008-editor.md#supported-markdown), such as a
table or front matter, shows as source in a dashed frame and is saved exactly
as it was.

| Control                         | Effect                                                             |
|---------------------------------|--------------------------------------------------------------------|
| The title in the header         | Edits it in place; `Enter` or leaving the field renames            |
| `Enter`                         | Starts a new line in a paragraph; twice, starts a new paragraph    |
| `Shift+Enter`                   | Starts a new line anywhere but a heading, including in a list item |
| `ArrowLeft` and `ArrowRight`    | Step across a shown marker, one side at a time                     |
| `Backspace` or `Delete`         | Into a shown marker, removes that formatting and keeps the text    |
| `Mod+S`                         | Saves at once instead of opening the browser's save dialog         |
| `Mod+K`                         | Adds, changes, or removes the link at the caret or selection       |
| `Mod+B`, `Mod+I`, and `Mod+E`   | Strong emphasis, emphasis, and code                                |
| `Mod+Z`, `Mod+Shift+Z`, `Mod+Y` | Undo and redo, kept per open document until it closes              |
| `Tab` and `Shift+Tab`           | Nest and unnest a list item; elsewhere, move focus out             |

Every change saves itself a second after typing pauses, and at least every
five seconds while it continues, and again on leaving the document, leaving
the writing surface, hiding the tab, or closing it. Beside the title, the
header shows a green Saved badge with a check, or says Saving, Retrying while
the service is unreachable,
Conflict, or Not saved when the service refuses the text, such as a document
over 1 MiB. Until the service acknowledges text, it is also kept in the
browser's IndexedDB database `writer`, so a reload or a closed tab loses
nothing; the next page saves it. When a document changed elsewhere, such as
its file in another editor, Writer keeps that version as a copy titled with
`(saved elsewhere)` beside it, saves the writer's text to the original, and
says so in a notice above the page.

### Dependencies and typefaces

| Package                                                                                                                                             | Purpose                                               |
|-----------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| `react-aria-components`                                                                                                                             | Buttons, menus, popovers, overlays, and tooltips      |
| `@tanstack/react-router`                                                                                                                            | Routes and typed links                                |
| `@tanstack/react-query`                                                                                                                             | Server-state cache and retries                        |
| `idb`                                                                                                                                               | IndexedDB access for unsaved text                     |
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, and the `@tiptap/extension-*` bold, italic, code, and heading marks and nodes | The editor, on ProseMirror                            |
| `mdast-util-from-markdown` and the `micromark-extension-*` and `mdast-util-*` GFM and front matter extensions                                       | Reading Markdown with source positions for the bridge |
| `@types/mdast` (development)                                                                                                                        | Syntax tree types                                     |
| `lucide-react`                                                                                                                                      | Icons                                                 |
| `@fontsource-variable/newsreader` and `@fontsource-variable/inter`                                                                                  | The self-hosted writing and interface typefaces       |
| `vite-css-modules` (development)                                                                                                                    | Typed CSS Module declarations                         |
| `@playwright/test` and `@axe-core/playwright` (development)                                                                                         | Browser tests and their accessibility checks          |

Writing is set in Newsreader, by Production Type, and the interface in Inter,
by Rasmus Andersson, both under the SIL Open Font License 1.1. The build
copies their font files into `dist/assets/` and emits each license beside
them as `inter-LICENSE.txt` and `newsreader-LICENSE.txt`, so the webapp
requests nothing from another origin. Colors follow the operating system's
light or dark preference.

## Setup

Install Node.js 26.13.1, the version [package.json](./package.json) pins in
`engines`, for example with `nvm install 26.13.1`. The
[development container](../.devcontainer/devcontainer.json) already carries
it. Then install dependencies from this folder:

```bash
npm ci
```

[.npmrc](./.npmrc) sends every install through the
`https://packagefeedproxy.microsoft.io/npm/` registry proxy, refuses other
Node.js versions, and runs no package install scripts. To confirm the proxy,
run `npm config get registry` here.

## Run the webapp

The page needs the service. Start it in one terminal, as the
[service guide](../service/README.md#run-the-service) describes:

```bash
cd service
cargo run -p writer-server
```

Then start the development server from this folder in another terminal:

```bash
npm run dev
```

Open `http://localhost:5180`. The workspace opens with no document; if the
service does not answer, the writing region reads `Writer can't reach the
service`. Start the service and choose Try again. The development server listens only on
`127.0.0.1:5180` and exits if the port is taken rather than choosing another;
stop the other program, or for a one-off run on the host pass another port,
such as `npm run dev -- --port 5181`. The server forwards every request under
`/api/` to the service at `http://127.0.0.1:8888` without changing the path,
so the browser talks to one origin and the service needs no cross-origin
configuration.

In VS Code's development container, port 5180 is forwarded, so the same
address works in a browser on the host. The Dev Container CLI does not forward
ports; check the page's request inside the container instead:

```bash
devcontainer exec --workspace-folder . curl http://127.0.0.1:5180/api/v1/health
```

## Configuration

The development server reads settings from its environment or from a
`webapp/.env` file, which Git ignores. [.env.example](./.env.example) lists
every setting. None of them reaches the browser bundle.

| Variable              | Default | Effect                                                     |
|-----------------------|---------|------------------------------------------------------------|
| `WRITER_SERVICE_PORT` | `8888`  | Loopback port, from 1 to 65535, that `/api/` is proxied to |

When the service runs on another port, point the proxy at it:

```bash
WRITER_SERVICE_PORT=8889 npm run dev
```

## Checks

The `webapp` phase of [tools/check](../tools/check), run from the repository
root after the `service` phase, runs these commands in this folder:

| Command                | Checks                                                                            |
|------------------------|-----------------------------------------------------------------------------------|
| `npm ci`               | Installs exactly the locked dependencies                                          |
| `npm run api:check`    | The generated client matches `service/openapi.json`                               |
| `npm run format:check` | Prettier formatting, except Markdown and generated files                          |
| `npm run lint`         | Oxlint with type-aware rules and warnings denied                                  |
| `npm run typecheck`    | Regenerates CSS Module declarations, then runs `tsc` over everything              |
| `npm run test`         | Vitest component and token contrast tests in jsdom, with no network access        |
| `npm run build`        | A production build in `dist/`, with the fonts and their licenses                  |
| `npm run budget`       | The built editor chunk and an open document's JavaScript within ADR 0008's budget |

After the service's contract changes, regenerate the client from this folder
and commit it with the contract:

```bash
npm run api:generate
```

Until you do, `npm run api:check` and `tools/check` fail with a message naming
`webapp/src/api/generated/schema.d.ts`. Fix formatting with `npm run format`.

### Browser tests

The `browser` phase of `tools/check`, after the `webapp` phase, runs
Playwright tests from [e2e/](./e2e/) in real browsers, as
[ADR 0009](../docs/adrs/0009-browser-tests.md) decides:

| Command                | Checks                                                                 |
|------------------------|------------------------------------------------------------------------|
| `npm run e2e:browsers` | Chromium and WebKit launch; exits 2, naming the fix, if one cannot     |
| `npm run e2e`          | Every browser test, with WCAG 2.2 AA checks by axe-core in both themes |

Each run starts the service with `cargo run` on loopback port 8898, with a
new, empty data folder, `writer-e2e-8898` in the system's temporary
directory, that it removes afterward, and this folder's development server
on port 5198 in Vite's `e2e` mode, which serves packages' production
exports as the build does, proxying to
it. It needs neither `npm run dev` nor a running service, and leaves those on
8888 and 5180 alone; it fails if 8898 or 5198 is taken. A test fails if the
page requests any other origin, so runs need no network.

Every test runs in four projects: Chromium and WebKit at a desktop size, and
WebKit with touch on an iPad in portrait and landscape. Firefox is not a
supported browser, so no project runs it. The responsiveness test, which
types into a synthetic 1 MiB document with the CPU throttled 4×, runs alone
in a fifth project, `responsiveness`, in desktop Chromium after the others
finish, because its timings need an otherwise idle machine and throttling
needs the Chrome DevTools Protocol. In CI, where `CI` is set and runners are
no particular hardware, it runs unthrottled against the same targets and
ADR 0008's unthrottled 33 ms for keystrokes. To run one
project, one file, or tests by title, pass Playwright's options after `--`:

```bash
npm run e2e -- --project=ipad-portrait
npm run e2e -- e2e/shell.spec.ts -g "collapses"
```

A failed test keeps a trace in `test-results/`, which Git ignores; open it
with `npx playwright show-trace <path to trace.zip>`.

The development container carries the browsers. On a host, install the
browsers for the locked Playwright release once, and again after it changes:

```bash
npx playwright install chromium webkit
```

On Linux, add `--with-deps` to install the system libraries they need, which
uses `sudo`.

The build prints Vite's advisory warning that the JavaScript chunk exceeds
500 KB minified; it fails nothing, and
[ADR 0008](../docs/adrs/0008-editor.md#bundle-budget) sets the budget the
webapp is held to.
