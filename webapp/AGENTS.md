---
title: Webapp Agent Guide
description: Purpose, boundaries, operational rules, governing decisions, and exact commands for coding agents working in webapp/
---

## Purpose and boundaries

`webapp/` is a client-rendered React 19 single-page application built with
Vite 8 that will become Writer's editing workspace. Today it shows the
service's health. People start with [README.md](./README.md).

* Reach the service only through its HTTP API, using the client in
  [src/api/client.ts](./src/api/client.ts) and types generated from the
  committed [service/openapi.json](../service/openapi.json). Never import from
  `service/` or call `fetch` for the API directly.
* Use same-origin paths under `/api/`; the development server proxies them to
  the service. Never put a service URL in the browser bundle or add a `VITE_`
  variable for one.
* Add no server rendering, framework server, or second server process. Routing,
  styling, server-state caching, and authentication wait for the stories and
  ADRs that choose them.

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

### Code and tests

* Keep `tsc`, Oxlint, and Prettier clean; fix findings rather than disabling
  rules. Lint and formatting skip the generated client, but `tsc` checks it.
* Place tests next to the code as `*.test.ts` or `*.test.tsx`. Replace `fetch`
  with `vi.stubGlobal`; tests never reach a real service or the network.
* Use synthetic prose in tests and fixtures, never a real manuscript.

### Toolchain and dependencies

* Change `engines.node` in [package.json](./package.json) and the Node.js
  `version` in [devcontainer.json](../.devcontainer/devcontainer.json)
  together, and update setup docs in [README.md](./README.md) and the root
  [README.md](../README.md) in the same change. `tools/check` refuses any other
  Node.js version.
* Install only through [.npmrc](./.npmrc), which sets the registry proxy,
  `save-exact`, `engine-strict`, and `ignore-scripts`. If a dependency needs an
  install script, name it here and run its step explicitly rather than enabling
  scripts.
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
npm run typecheck                        # tsc without emitting
npm run test                             # Vitest once
npm run build                            # production build in dist/
npm config get registry                  # expect the packagefeedproxy.microsoft.io proxy
```

Before reporting work complete, run `tools/check` from the repository root.
Its `webapp` phase runs `npm ci --include=dev --no-audit --no-fund`, then
`npm run api:check`, `format:check`, `lint`, `typecheck`, `test`, and `build`.
