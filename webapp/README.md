---
title: Writer webapp
description: How to set up, run, configure, and check the Writer webapp, a React single-page application that calls the service through a generated API client
author: Tim Park
ms.date: 2026-11-20
ms.topic: overview
keywords:
  - webapp
  - react
  - vite
  - openapi
---

## Overview

The webapp is Writer's client, a React single-page application built with
Vite. Today it shows one page that reports the service's health from
`GET /api/v1/health`. Coding agents start with [AGENTS.md](./AGENTS.md); the
architecture is recorded in
[ADR 0003](../docs/adrs/0003-webapp-architecture.md) and the API conventions
in [ADR 0004](../docs/adrs/0004-api-conventions.md).

| Path                                             | Responsibility                                                               |
|--------------------------------------------------|------------------------------------------------------------------------------|
| [src/App.tsx](./src/App.tsx)                     | The page, which shows the service's health status                            |
| [src/api/client.ts](./src/api/client.ts)         | The only module that calls the service, through openapi-fetch                |
| [src/api/generated/](./src/api/generated/)       | Types generated from [service/openapi.json](../service/openapi.json)         |
| [scripts/api-check.js](./scripts/api-check.js)   | Fails when the generated types differ from the contract                      |
| [vite.config.ts](./vite.config.ts)               | Development server, `/api/` proxy, build, and Vitest settings                |

The generated types are committed. Never edit them by hand; regenerate them
as [Checks](#checks) describes.

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

Open `http://localhost:5180`. The page reads `Service status: ok` when the
service answers, and `Service status: unreachable` when it does not; start
the service and reload. The development server listens only on
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
| `npm run typecheck`    | `tsc` over the application, its tests, and its configuration                  |
| `npm run test`         | Vitest component tests in jsdom, with `fetch` replaced and no network access  |
| `npm run build`        | A production build in `dist/`                                                 |

After the service's contract changes, regenerate the client from this folder
and commit it with the contract:

```bash
npm run api:generate
```

Until you do, `npm run api:check` and `tools/check` fail with a message naming
`webapp/src/api/generated/schema.d.ts`. Fix formatting with `npm run format`.
