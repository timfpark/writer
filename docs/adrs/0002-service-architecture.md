---
title: "ADR 0002: Service HTTP framework, crate layout, and API contract"
description: Selects axum on Tokio for the service, defines its first internal crates and their dependency direction, and emits a verified OpenAPI 3.1 contract from code with utoipa
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - service
keywords:
  - adr
  - rust
  - axum
  - tokio
  - utoipa
  - openapi
  - cargo workspace
estimated_reading_time: 10
---

## Status

Accepted on 2026-11-19.

[ADR 0003](./0003-webapp-architecture.md) settles the cross-origin question
this record leaves open: the webapp's development server proxies `/api/` to the
service, so the service serves every API route under `/api/` and adds no CORS
layer. ADR 0003 also records that its chosen generator does not yet read
OpenAPI 3.2.

[ADR 0004](./0004-api-conventions.md) settles the API conventions follow-up:
routes live under `/api/v1/`, errors are RFC 9457 problem details, and it sets
path, field, operation ID, and SSE framing rules. It defers pagination and
idempotency, each with the trigger that reopens it. It also refines the
router-test rule below: an error status produced by shared code is tested once
against that code rather than through every operation.

## Decision summary

* Build the HTTP service on axum 0.8 and Tokio 1's multithreaded runtime,
  binding `127.0.0.1:8080` by default with graceful shutdown and no CORS layer.
* Organize `service/` as a Cargo workspace (Rust edition 2024, resolver 3,
  `publish = false`) with downward-only dependencies: thin `writer-server`
  executable to `writer-api` library to feature crates to pure domain crate.
* Confine axum and Tower types to `writer-server` and `writer-api`, and utoipa
  types to `writer-api`.
* Emit deterministic OpenAPI 3.1.0 JSON from `OpenApiRouter` to
  `service/openapi.json`; verify freshness in tests and regenerate from
  `service/` with `UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi`.
* Run blocking or CPU-heavy work via `tokio::task::spawn_blocking` behind a
  bounded permit, stream incremental responses over SSE, and test handlers
  through the router as a Tower service without binding a socket.

## Context

The Writer service stores text, applies business rules, serves the HTTP API,
and runs the pair-writing agent. [ADR 0001](./0001-monorepo-structure.md)
requires a Cargo workspace inside `service/` with a thin executable and focused
library crates under `service/crates/`. It makes a checked-in OpenAPI document
under `service/` the contract of record and requires the service's checks to
fail when that document and the implementation disagree. It left the HTTP
framework, the crate responsibilities, and how the contract is produced to
this decision.

The first deployment is local: one user, one service process, listening on
loopback port 8080. The webapp calls the service only through a TypeScript
client generated from the contract (though other clients are potentially
envisioned), chosen in [ADR 0003](./0003-webapp-architecture.md).
The pair-writing agent will make slow outbound calls to model providers and
will likely stream suggestions back to the browser as they arrive, so request
handling must overlap long-lived I/O without blocking other requests.

An earlier project chose axum, Tokio, and SQLx for a similar local service.
We reuse its framework and runtime reasoning, revisited against current
releases. Its storage choice is out of scope here. Storage, the agent
framework, model providers, authentication, and API conventions such as
versioning and error payloads each need their own decision.

A prototype built outside the repository confirmed that the selected releases
resolve together under the container's Rust toolchain, emit an OpenAPI 3.1.0
document, and fail the freshness test when a route changes without
regenerating the contract.

## Decision drivers

* A small JSON HTTP API consumed through a generated TypeScript client
* A contract that cannot silently drift from the routes the service serves
* Overlapping long-lived outbound calls and streamed responses on one runtime
* Router tests that run without binding a network port
* Focused crates with narrow public APIs and an explicit dependency direction
* Few dependencies, each with only the features the service uses

## Considered options

### HTTP framework

1. Axum provides explicit router composition, typed extractors, ordinary async
   handlers, and Tower middleware. A router is a Tower service, so tests call
   it directly without a socket. It is built on Hyper and Tokio and supports
   server-sent events (SSE) and WebSockets. The released line is 0.8; 0.9 is
   in development and will bring breaking changes. It has the widest
   ecosystem support of the options here, including the OpenAPI generators
   below.
2. Actix Web is mature and fast, with its own extractors, middleware, and test
   utilities. Its middleware model is separate from Tower, and the OpenAPI
   generators below integrate less directly with it. No performance
   requirement favors it.
3. Poem with poem-openapi derives routing and the OpenAPI document from one
   set of declarations, which removes a class of drift. It couples the
   contract generator to the framework, so changing either means changing
   both, and its ecosystem is smaller than axum's.
4. Dropshot, from Oxide Computer, also derives the document from endpoint
   declarations. It is opinionated toward Oxide's API conventions, uses its
   own server and middleware model rather than Tower, and has a smaller user
   base outside Oxide.
5. Hyper alone provides HTTP primitives but leaves routing, extraction, and
   error mapping to us.

### Async runtime

1. Tokio's multithreaded runtime is the runtime axum targets. It supplies
   networking, timers, synchronization, signal handling, and async test
   support, and overlaps many slow outbound calls without a thread per
   request.
2. Tokio's current-thread runtime would serve one local user, but leaves no
   scheduling headroom when a long agent stream and ordinary requests overlap.
   It does not make blocking work safe.
3. Smol and other runtimes would require a different framework without a
   benefit. We do not combine runtimes.

### Contract production

1. Code-first with utoipa and utoipa-axum: handlers carry a
   `#[utoipa::path]` attribute and transport types derive `ToSchema`. An
   `OpenApiRouter` registers each handler's route and its documentation in one
   call, so a route cannot be served without appearing in the document.
   Status codes and response bodies are still declared in the attribute rather
   than inferred from the handler's return type. utoipa is the most widely used
   option, emits OpenAPI 3.1 by default, and added OpenAPI 3.2 output in 6.0.
2. Code-first with aide infers more of each operation from extractor and
   response types, which narrows the declared-versus-actual gap. It builds
   schemas with schemars, emits only OpenAPI 3.1, has a much smaller user base,
   and its next release line has been in alpha for months.
3. A hand-written document with the code verified against it puts API design
   first. Rust has no widely adopted generator of axum server code from a
   document; the most established, OpenAPI Generator's `rust-axum` target,
   needs a JVM that the development container does not carry. Verification
   would rest on runtime request and response validation in tests, and two
   artifacts would need to be kept in step by hand.
4. Framework-integrated generators such as poem-openapi and Dropshot are
   covered above. They would decide the framework through the contract tool.

### OpenAPI version

1. OpenAPI 3.1 aligns schemas with JSON Schema 2020-12 and is read by every
   mainstream TypeScript client generator.
2. OpenAPI 3.2, published in September 2025, adds `itemSchema` to describe
   each event in an SSE or JSON Lines stream, which suits streamed agent
   suggestions. As of November 2026, hey-api and openapi-typescript, two of
   the leading TypeScript generators, still have open requests to read 3.2
   documents. Choosing it now would constrain the webapp ADR to generators that
   may not exist.
3. OpenAPI 3.0 has the widest legacy support but a JSON Schema dialect that
   differs from 3.1's, including its own `nullable` keyword. Nothing in our
   toolchain requires it.

## Decision

### Framework and runtime

Use axum on Tokio's multithreaded runtime. Start on axum 0.8 and the
compatible releases of Tokio 1, utoipa 6, and utoipa-axum 0.3. Use Tower and
`tower-http` layers for cross-cutting concerns such as tracing, request
identifiers, and timeouts as stories need them. Disable default features where
practical and enable only the features the service uses. Resolved versions
live in `service/Cargo.lock`; upgrading within these choices is a dependency
change, not a new decision.

utoipa-axum is built against a specific axum minor version. Upgrade axum to
0.9 only when a compatible utoipa-axum release exists, and upgrade both in the
same change.

### Crate layout

Create the workspace as [ADR 0001](./0001-monorepo-structure.md#repository-layout)
describes, with Rust edition 2024 and Cargo's version 3 resolver. Declare
shared dependency versions once under `[workspace.dependencies]` and shared
lint settings under `[workspace.lints]`, and have members inherit them. Each
crate's folder under `service/crates/` matches its package name.

The service foundation creates two crates:

| Crate           | Kind       | Responsibility                                                                                                                         | May depend on                       |
|-----------------|------------|----------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| `writer-server` | Executable | Reads configuration, initializes logging, binds the listener, serves the router, and shuts down gracefully. Holds no routes or rules.  | `writer-api`, Tokio, axum           |
| `writer-api`    | Library    | Routes, handlers, transport types, mapping errors to HTTP responses, assembling the OpenAPI document, and the contract freshness test. | Lower internal crates, axum, utoipa |

Later crates join below `writer-api` when a story delivers their behavior,
never as placeholders. We expect a pure domain crate for text and business
rules, a storage crate shaped by the storage ADR, and an agent crate for prompts
and model provider calls. Their names and boundaries are settled by the
stories that create them, within these rules:

* Dependencies point downward: `writer-server` → `writer-api` → feature crates
  such as storage and agent → the domain crate. No crate depends on
  `writer-server`, and a lower crate never depends on a higher one.
* Only `writer-api` and `writer-server` depend on axum, and only `writer-api`
  depends on utoipa. Crates below the API expose no axum, Tower, or utoipa
  types.
* Transport types that appear in the contract live in `writer-api` and map to
  and from domain types. An internal refactor cannot change the contract
  without the freshness test noticing.
* Every crate sets `publish = false`. Cargo rejects dependency cycles; review
  enforces direction, and [service/AGENTS.md](../../service/AGENTS.md) restates these rules.

### Contract production and freshness

Emit the contract from code with utoipa. Commit it as `service/openapi.json`:
pretty-printed JSON, OpenAPI 3.1.0, ending in a newline. JSON needs no
dependency beyond the `serde_json` the service already uses, and every
TypeScript generator reads it.

`writer-api` builds the served router and the document from the same
`OpenApiRouter`, so routes and documented paths come from one registration.
The document must be deterministic: it carries no host names, ports, build
timestamps, or other machine-specific values.

An integration test, [openapi.rs](../../service/crates/writer-api/tests/openapi.rs),
generates the document and compares it byte for byte with
`service/openapi.json`. On a mismatch it fails with a message naming
`service/openapi.json` and the command that regenerates it. Running that test
with `UPDATE_OPENAPI=1` rewrites the file instead, so the regeneration command,
run from `service/`, is:

```bash
UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi
```

The `service` phase of `tools/check` runs the workspace tests with
`UPDATE_OPENAPI` removed from the environment, so the gate and CI always
compare rather than rewrite. A stale contract therefore fails `tools/check`
with exit status 1.

The attribute on each handler declares its status codes and bodies, and the
compiler does not check them against the handler's return type. Router tests
cover that gap: each documented response is exercised and its body decoded
into the documented type.

Until the service adopts OpenAPI 3.2, document a streaming endpoint as a
`text/event-stream` response and register each event payload type as a named
schema under `components`, so the generated client still exports its type.

Do not serve an interactive documentation UI. It would add vendored assets
and routes without a current need.

### Request execution

* Bind `127.0.0.1:8080` by default. Exposure beyond loopback requires an
  authentication and hosting decision first.
* Await async I/O directly. Run blocking or substantial CPU work, such as
  whole-manuscript analysis, through `tokio::task::spawn_blocking` behind a
  bounded concurrency permit held until the work finishes.
* Make outbound model provider calls with an async client on the same Tokio
  runtime. The agent decision selects the client and provider.
* Stream incremental results with axum's SSE support rather than holding a
  request open for a complete response.
* On SIGINT or SIGTERM, stop accepting connections, drain in-flight requests
  within a deadline, and end open streams before the runtime stops.
* Add cross-origin support only if the webapp ADR requires it, limited to the
  local development origin it names.

### Testing

* Test handlers through the router as a Tower service, without binding a
  port, covering each documented status code and body.
* The contract freshness test runs with the ordinary workspace tests.
* Keep domain logic in crates that test without axum or a runtime.
* A smoke test of the executable's startup and shutdown arrives with the
  service foundation.

## Consequences

Positive outcomes:

* The contract is generated, so the webapp's client and the served routes
  share one source, and drift fails the gate with a named file and a fix.
* The thin executable and framework-free lower crates keep business logic
  testable without HTTP.
* Axum and Tower give the agent's streaming and middleware needs a
  well-supported path.

Trade-offs and risks:

* Handler attributes duplicate facts the compiler cannot check. Router tests
  must exercise every documented response, or the document can be wrong in
  detail while still fresh.
* utoipa-axum couples axum upgrades to utoipa's release schedule.
* Contract design happens in Rust code review rather than in a document first.
  Reviewers read the diff to `service/openapi.json` to see the API change.
* OpenAPI 3.1 cannot describe the items in a stream, so streamed event types
  are typed only by convention until the move to 3.2.

## Revisit triggers

* Move to OpenAPI 3.2 when the webapp's chosen generator reads it and an
  endpoint streams events. utoipa 6 already emits 3.2, so the change is a
  configuration and regeneration step plus a client regeneration.
* Revisit the framework if axum 0.9 arrives without a compatible utoipa-axum
  release within a reasonable window, or if utoipa stops being maintained.
* Revisit the runtime decision if sustained CPU-heavy analysis needs a
  dedicated executor.

## Follow-up decisions

* Storage engine, schema ownership, and migrations
* Agent framework, model providers, prompt loading, and evaluation running
* API conventions: paths and versioning, error payloads, pagination, and
  idempotency
* Authentication and any hosting beyond loopback

## References

* [axum documentation](https://docs.rs/axum/latest/axum/)
* [Tokio `spawn_blocking`](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
* [utoipa documentation](https://docs.rs/utoipa/latest/utoipa/)
* [utoipa changelog, including 3.2 support in 6.0](https://github.com/juhaku/utoipa/blob/master/utoipa/CHANGELOG.md)
* [utoipa-axum documentation](https://docs.rs/utoipa-axum/latest/utoipa_axum/)
* [aide](https://github.com/tamasfe/aide)
* [poem-openapi](https://github.com/poem-web/poem/tree/master/poem-openapi)
* [Dropshot](https://github.com/oxidecomputer/dropshot)
* [OpenAPI 3.1.0 specification](https://spec.openapis.org/oas/v3.1.0.html)
* [OpenAPI 3.2.0 specification](https://spec.openapis.org/oas/v3.2.0.html)
* [hey-api request for OpenAPI 3.2](https://github.com/hey-api/hey-api/issues/2660)
* [openapi-typescript request for OpenAPI 3.2](https://github.com/openapi-ts/openapi-typescript/issues/2577)
