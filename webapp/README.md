---
title: Writer webapp
description: How to set up, run, configure, and check the Writer webapp, a React single-page workspace shell that calls the service through a generated API client
author: Tim Park
ms.date: 2026-11-20
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
navigator and assistant hold placeholders until later stories fill them.
Coding agents start with [AGENTS.md](./AGENTS.md); the architecture is
recorded in [ADR 0003](../docs/adrs/0003-webapp-architecture.md), the API
conventions in [ADR 0004](../docs/adrs/0004-api-conventions.md), and the
interface foundation in [ADR 0007](../docs/adrs/0007-webapp-interface.md).

| Path                                                   | Responsibility                                                               |
|--------------------------------------------------------|------------------------------------------------------------------------------|
| [src/main.tsx](./src/main.tsx)                         | Startup: global styles, the query client, and the router                     |
| [src/router.tsx](./src/router.tsx)                     | The typed route tree for `/`, `/documents/$documentId`, and not-found paths  |
| [src/shell/](./src/shell/)                             | The header, the side panes, their shortcuts, and stored pane preferences     |
| [src/workspace/](./src/workspace/)                     | What the writing region and the side panes show                              |
| [src/styles/](./src/styles/)                           | Design tokens for both themes, global styles, and the token contrast test    |
| [src/api/client.ts](./src/api/client.ts)               | The only module that calls the service, through openapi-fetch                |
| [src/api/queries.ts](./src/api/queries.ts)             | The query client, retry policy, and query options components read through    |
| [src/api/generated/](./src/api/generated/)             | Types generated from [service/openapi.json](../service/openapi.json)         |
| [scripts/api-check.js](./scripts/api-check.js)         | Fails when the generated types differ from the contract                      |
| [vite.config.ts](./vite.config.ts)                     | Development server, `/api/` proxy, CSS Modules, font licenses, and Vitest    |

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

`Mod` is Command on macOS and iPadOS and Control elsewhere. In a window 75 rem
(1,200 px at the default text size) or wider, both panes dock beside the
writing region. From 60 to 75 rem the assistant opens over the writing region,
and below 60 rem both do, so the region keeps its width on an iPad in either
orientation. A pane over the writing region closes on `Escape`, a tap outside
it, its close button, or a change of route. Whether each docked pane is
collapsed is kept in `localStorage` under `writer.navigator.collapsed` and
`writer.assistant.collapsed`, so it survives a reload.

The header's title slot shows the open document's title, or Writer's name at
`/`. When the service cannot be reached, the writing region says so and
offers to try again.

### Dependencies and typefaces

| Package                                                                | Purpose                                                 |
|------------------------------------------------------------------------|---------------------------------------------------------|
| `react-aria-components`                                                | Buttons, menus, popovers, overlays, and tooltips        |
| `@tanstack/react-router`                                               | Routes and typed links                                  |
| `@tanstack/react-query`                                                | Server-state cache and retries                          |
| `idb`                                                                  | IndexedDB access for unsaved text, used by backlog 23   |
| `lucide-react`                                                         | Icons                                                   |
| `@fontsource-variable/newsreader` and `@fontsource-variable/inter`     | The self-hosted writing and interface typefaces         |
| `vite-css-modules` (development)                                       | Typed CSS Module declarations                           |

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

| Variable              | Default | Effect                                                       |
|-----------------------|---------|--------------------------------------------------------------|
| `WRITER_SERVICE_PORT` | `8888`  | Loopback port, from 1 to 65535, that `/api/` is proxied to   |

When the service runs on another port, point the proxy at it:

```bash
WRITER_SERVICE_PORT=8889 npm run dev
```

## Checks

The `webapp` phase of [tools/check](../tools/check), run from the repository
root after the `service` phase, runs these commands in this folder:

| Command                | Checks                                                                        |
|------------------------|-------------------------------------------------------------------------------|
| `npm ci`               | Installs exactly the locked dependencies                                      |
| `npm run api:check`    | The generated client matches `service/openapi.json`                           |
| `npm run format:check` | Prettier formatting, except Markdown and generated files                      |
| `npm run lint`         | Oxlint with type-aware rules and warnings denied                              |
| `npm run typecheck`    | Regenerates CSS Module declarations, then runs `tsc` over everything          |
| `npm run test`         | Vitest component and token contrast tests in jsdom, with no network access    |
| `npm run build`        | A production build in `dist/`, with the fonts and their licenses              |

After the service's contract changes, regenerate the client from this folder
and commit it with the contract:

```bash
npm run api:generate
```

Until you do, `npm run api:check` and `tools/check` fail with a message naming
`webapp/src/api/generated/schema.d.ts`. Fix formatting with `npm run format`.

The build prints Vite's advisory warning that the JavaScript chunk exceeds
500 KB minified; it fails nothing, and
[ADR 0008](../docs/adrs/0008-editor.md#bundle-budget) sets the budget the
webapp is held to.
