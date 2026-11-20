---
title: Service Agent Guide
description: Purpose, crate boundaries, operational rules, governing decisions, and exact commands for coding agents working in service/
---

## Purpose and boundaries

`service/` is a Cargo workspace that serves Writer's HTTP API on loopback
and, in later stories, stores the workspace and runs the pair-writing agent.
Clients reach it only through the API and the committed
[openapi.json](./openapi.json); the service never imports client code. People
start with [README.md](./README.md).

| Crate                                    | Responsibility                                                                           | May depend on                       |
|------------------------------------------|------------------------------------------------------------------------------------------|-------------------------------------|
| [writer-server](./crates/writer-server/) | Reads configuration, logs, binds `127.0.0.1`, serves, and shuts down; no routes or rules | `writer-api`, Tokio, axum           |
| [writer-api](./crates/writer-api/)       | Routes, handlers, transport types, `Problem` errors, and the OpenAPI document            | Lower internal crates, axum, utoipa |

* Dependencies point downward: `writer-server` to `writer-api` to feature
  crates such as storage or agent to a pure domain crate. Nothing depends on
  `writer-server`, and a lower crate never depends on a higher one.
* Only `writer-api` and `writer-server` use axum or Tower types, and only
  `writer-api` uses utoipa. Lower crates expose none of them.
* Add a crate under `crates/` only with the behavior that needs it, named as
  its folder, inheriting `[workspace.package]` and `[lints] workspace = true`.
* `service/prompts/` and `service/evals/` (planned) arrive with backlog 12,
  the first pair-writing agent story; do not create them empty.

## Operational rules

### Routes and the contract

* Register every route in `v1()` in
  [writer-api/src/lib.rs](./crates/writer-api/src/lib.rs) through
  `OpenApiRouter` with `routes!`, so it is served and documented together.
  Handler paths are relative to `/api/v1`.
* Give every `#[utoipa::path]` an explicit camelCase `operation_id` (such as
  `getHealth`) and exactly one `tag` equal to the first path segment after the
  version, declared in `ApiDoc`'s `tags(...)`.
* Use lowercase kebab-case plural nouns for collections, singular nouns for
  singletons, camelCase parameters, and opaque string `*Id` identifiers. A
  stateless computation is a `POST` to a plural result noun; manuscript text
  never goes in a path or query string.
* Annotate transport types with `#[serde(rename_all = "camelCase")]`; add
  `deny_unknown_fields` to request types. A response `Option<T>` gets
  `#[schema(required = true)]`; an optional request field gets
  `#[serde(default)]` and `#[schema(nullable = false)]`. Bodies are objects,
  collections use an `items` array, and arrays are never `null`.
* Never edit [openapi.json](./openapi.json) by hand. Regenerate it with the
  command under [Commands](#commands) and commit it with the route change.
* Serve no CORS layer and no documentation UI; the webapp reaches `/api/`
  through its development server's proxy.

### Errors and privacy

* Every error response is a `Problem` (`application/problem+json`). Return
  `Problem` or a type that converts into it, and use the `Json`, `Path`, and
  `Query` extractors in `writer-api`'s `extract` module rather than axum's, so
  rejections become problems.
* Pick the `ProblemCode` from ADR 0004's table; each code has one status.
* Document every error status an operation can return, including 500, with
  `body = Problem, content_type = "application/problem+json"`. Operations
  with a body also document 400, 413, 415, and 422.
* Never place request content, manuscript text, credentials, serde or
  rejection messages, or provider responses in `detail`, `errors`, or logs.
  Never log bodies or query strings.

### Execution and tests

* Await async I/O directly. Run blocking or CPU-heavy work with
  `tokio::task::spawn_blocking` behind a bounded permit. Stream incremental
  results over SSE with ADR 0004's `done` and `error` framing.
* Test each documented response through `writer_api::router()` as a Tower
  service without binding a socket, decoding its body into the documented
  type. Test shared error code once, in
  [writer-api/src/tests.rs](./crates/writer-api/src/tests.rs), with the
  synthetic marker.
* Use synthetic prose in tests and fixtures, never a real manuscript.

### Toolchain and dependencies

* Change [rust-toolchain.toml](./rust-toolchain.toml) and the Rust `version`
  in [devcontainer.json](../.devcontainer/devcontainer.json) together, and
  update setup docs in [README.md](./README.md) and the root
  [README.md](../README.md) in the same change.
* Declare each dependency once in `[workspace.dependencies]` with default
  features off where practical, and inherit it in members.
* Pick versions with no known advisory; CI's dependency review fails on any
  vulnerability, in any scope and severity. Upgrade axum and utoipa-axum
  together.
* Cargo uses crates.io directly; no registry proxy is required.

## Governing decisions

Consult these when changing architecture, dependencies, or conventions:

* [ADR 0001](../docs/adrs/0001-monorepo-structure.md): repository layout,
  subsystem boundaries, the validation gate, and toolchain pinning
* [ADR 0002](../docs/adrs/0002-service-architecture.md): axum and Tokio, crate
  layout and dependency direction, and the utoipa contract
* [ADR 0003](../docs/adrs/0003-webapp-architecture.md): the webapp's
  same-origin `/api/` proxy to port 8080 and generated client
* [ADR 0004](../docs/adrs/0004-api-conventions.md): versioning, naming,
  problem details, operation IDs and tags, and SSE framing

## Commands

Run Cargo commands from `service/`:

```bash
cargo run -p writer-server                                 # serve on 127.0.0.1:8080
WRITER_PORT=8081 cargo run -p writer-server                # serve on another loopback port
curl http://127.0.0.1:8080/api/v1/health                   # expect {"status":"ok"}
cargo test --workspace                                     # every test, including the contract check
cargo test -p writer-api --test conventions                # ADR 0004 conventions only
UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi   # regenerate openapi.json
cargo fmt --all                                            # format
```

Before reporting work complete, run `tools/check` from the repository root.
Its `service` phase runs `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`,
`cargo build --workspace --all-targets --locked`, and
`cargo test --workspace --locked` with `UPDATE_OPENAPI` unset.
