---
title: Establish the webapp subsystem foundation
description: Create webapp/ with a pinned runtime, a generated API client, and its validation phase, following the webapp architecture ADR.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want a minimal, validated `webapp/` folder
that talks to the service only through its contract so that client features
start inside the boundaries [ADR 0001](../adrs/0001-monorepo-structure.md)
set out.

## Context

ADR 0001 places the webapp's manifest, lockfile, Node.js version, `.npmrc`,
configuration example, and generated API client inside `webapp/`. The client is
generated from the service's committed OpenAPI document and checked for
freshness. The webapp architecture ADR from
[backlog 9](./0009-webapp-architecture-adr.md) chooses the build tool, the
client generator, and the development server port. If building reveals a flaw
in that decision, amend the ADR in the same pull request.

## Scope

* Create `webapp/` with `package.json` (Node.js version in `engines`),
  `package-lock.json`, an `.npmrc` that sets the
  `https://packagefeedproxy.microsoft.io/npm/` proxy, and an `.env.example`
  with no real values.
* Generate the API client into `webapp/src/api/generated/` from the service
  contract and render the service's health status on one page.
* Add a `webapp` phase to `tools/check`, after the `service` phase, running
  formatting, lint, type checks, tests, build, and a client freshness check.
* Apply the root guide's "Adding a subsystem" checklist, including
  `webapp/README.md` with its development port, `webapp/AGENTS.md` with
  Governing decisions and exact commands, and an npm Dependabot entry that uses
  the proxy registry.

## Acceptance criteria

* [ ] The build tool, client generator, and port match the webapp ADR, and
  `webapp/AGENTS.md` links it under Governing decisions.
* [ ] Following `webapp/README.md`, the page shows the service's health status
  on a host and in the development container.
* [ ] Changing the service contract without regenerating the client makes
  `tools/check` exit 1 with a message naming the generated client.
* [ ] `npm config get registry` inside `webapp/` reports the proxy.
* [ ] The root guides list `webapp/` as existing and link its guide.

## Prerequisites

* [Establish the service subsystem foundation](./0006-service-foundation.md)
* [Record the webapp architecture ADR](./0009-webapp-architecture-adr.md)
