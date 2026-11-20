---
title: Service Agent Guide
description: Purpose, crate boundaries, operational rules, governing decisions, and exact commands for coding agents working in service/
---

## Purpose and boundaries

`service/` is a Cargo workspace that serves Writer's HTTP API on loopback,
stores the workspace in a data folder, and, in later stories, runs the
pair-writing agent.
Clients reach it only through the API and the committed
[openapi.json](./openapi.json); the service never imports client code. People
start with [README.md](./README.md).

| Crate                                      | Responsibility                                                                                          | May depend on                                                                                            |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| [writer-server](./crates/writer-server/)   | Reads configuration, logs, opens storage, binds `127.0.0.1`, serves, and shuts down; no routes or rules | `writer-api`, `writer-storage`, Tokio, axum                                                              |
| [writer-api](./crates/writer-api/)         | Routes, handlers, transport types, `Problem` errors, and the OpenAPI document                           | Lower internal crates, axum, utoipa                                                                      |
| [writer-storage](./crates/writer-storage/) | `WorkspaceStore`, `StoreError`, revisions, the conformance suite, and the filesystem backend            | `writer-domain`, Tokio, serde, `sha2`, `tempfile`, `unicase`, `unicode-normalization`, `uuid`, `tracing` |
| [writer-domain](./crates/writer-domain/)   | Workspace types, limits, and the `Tree` checks every backend applies; no I/O                            | Nothing internal; no runtime or framework                                                                |

* Dependencies point downward: `writer-server` to `writer-api` to feature
  crates such as `writer-storage` or agent to `writer-domain`.
  `writer-server` also depends on `writer-storage` to open the configured
  backend. Nothing depends on `writer-server`, and a lower crate never
  depends on a higher one.
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
* Handlers reach storage only through the `State<Store>` (an
  `Arc<dyn WorkspaceStore>`) that `writer_api::router(store)` takes, and map
  transport types to `writer-domain` types before calling it. Raise a body
  limit per route with `routes!(...).layer(DefaultBodyLimit::max(...))`, as
  the two operations that carry content do.
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
  `#[serde(default)]` and `#[schema(nullable = false)]`; a request field whose
  `null` carries meaning, such as `parentId`, gets `#[schema(required = true)]`
  and rejects omission. Bodies are objects, collections use an `items` array,
  and arrays are never `null`.
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
  with a body also document 400, 413, 415, and 422, by listing
  `BodyProblems` in `responses(...)`.
* Convert a `StoreError` into a `Problem` with `?`, which applies ADR 0006's
  mapping and logs internal failures by operation, identifier, and error
  kind only.
* Never place request content, manuscript text, credentials, serde or
  rejection messages, or provider responses in `detail`, `errors`, or logs.
  Never log bodies or query strings.

### Execution and tests

* Await async I/O directly. Run blocking or CPU-heavy work with
  `tokio::task::spawn_blocking` behind a bounded permit. Stream incremental
  results over SSE with ADR 0004's `done` and `error` framing.
* Test each documented response through `writer_api::router(store)` as a
  Tower service without binding a socket, over a `FilesystemStore` opened in
  a `tempfile::TempDir`, decoding its body into the documented type. Test
  shared error code once, in
  [writer-api/src/tests.rs](./crates/writer-api/src/tests.rs), with the
  synthetic marker. Send the marker in titles and content in
  [writer-api/tests/workspace.rs](./crates/writer-api/tests/workspace.rs),
  whose captured logs must never contain it.
* Use synthetic prose in tests and fixtures, never a real manuscript.

### Storage

* Put a workspace rule in `writer-domain`, tested there without storage, and
  have every backend apply it through `Tree::check_create` or
  `Tree::check_place` under its write lock, in the same step as the write.
* Give every `WorkspaceStore` behavior a case in `writer-storage`'s
  `conformance` module, expanded by `conformance_tests!`, in the same change;
  test backend-specific rules beside the backend.
* Run each filesystem operation's whole sequence of `std::fs` calls in one
  `spawn_blocking` task that owns the lock guard and a permit, never through
  `tokio::fs`. Every file write goes through `.writer/tmp/`, `sync_all`,
  rename, and a directory sync; a structural change is one rename recorded
  as `pending` in the index first.
* Add a `disk.step("...")` seam before each new I/O step, so the
  interruption tests fail and stop the operation there.
* Storage errors and logs name the operation, item identifier, and I/O
  error kind, never a path inside the workspace, a title, or content.
* Storage constructors take an explicit location; only `writer-server`
  resolves `WRITER_DATA_DIR` and its defaults. Tests open stores in a
  `tempfile::TempDir` and start `writer-server` with `WRITER_DATA_DIR` set to
  one.

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
  same-origin `/api/` proxy to port 8888 and generated client
* [ADR 0004](../docs/adrs/0004-api-conventions.md): versioning, naming,
  problem details, operation IDs and tags, and SSE framing
* [ADR 0005](../docs/adrs/0005-workspace-model.md): the folder and document
  model, its limits, the workspace operations, revision-checked saves, and
  the `writer-domain` crate
* [ADR 0006](../docs/adrs/0006-storage-architecture.md): the
  `WorkspaceStore` interface and conformance suite, the filesystem backend,
  content-hash revisions, `WRITER_DATA_DIR`, and the SQLx path

## Commands

Run Cargo commands from `service/`:

```bash
cargo run -p writer-server                                 # serve on 127.0.0.1:8888
WRITER_PORT=8889 cargo run -p writer-server                # serve on another loopback port
curl http://127.0.0.1:8888/api/v1/health                   # expect {"status":"ok"}
cargo test --workspace                                     # every test, including the contract check
cargo test -p writer-domain                                # workspace rules only
cargo test -p writer-storage                               # conformance suite and filesystem backend
cargo test -p writer-storage conformance::                 # conformance suite only
WRITER_DATA_DIR=/tmp/writer-data cargo run -p writer-server # serve with data in another folder
cargo test -p writer-api --test conventions                # ADR 0004 conventions only
cargo test -p writer-api --test workspace                  # workspace operations through the router
UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi   # regenerate openapi.json
cargo fmt --all                                            # format
```

Before reporting work complete, run `tools/check` from the repository root.
Its `service` phase runs `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`,
`cargo build --workspace --all-targets --locked`, and
`cargo test --workspace --locked` with `UPDATE_OPENAPI` unset.
