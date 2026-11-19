---
title: 'ADR 0001: Service API, Async Runtime, and SQLite'
description: Decision record selecting Axum, Tokio, and SQLx for the portfolio service API and SQLite persistence
author: Tim Park
ms.date: 2026-11-11
ms.topic: concept
subsystems:
  - service
keywords:
  - adr
  - rust
  - axum
  - tokio
  - sqlx
  - sqlite
estimated_reading_time: 9
---

## Status

Accepted on 2026-10-15.

[ADR 0003](./0003-storage-boundary-and-backend-portability.md) refines the storage
boundary and replaces direct pool exposure in Axum state with application-service
handles backed by that pool. All other operational requirements remain in force.

[ADR 0009](./0009-authentication-and-initial-tenancy.md), accepted on 2026-10-18,
extends the initial single-user deployment to two authenticated tenants and
distinct agent principals in one shared-schema SQLite database. It adds an
authenticated loopback mode, an exclusive process lock enforcing the single
database owner, offline operator commands, and per-principal admission. The
single bounded pool and other runtime constraints remain. Exposure beyond
loopback requires a separate Kubernetes hosting decision.

Amended on 2026-11-11 to run migrations with foreign key enforcement off and
check foreign keys before each migration commits, after migration 0034's
rebuild of a referenced table failed on a database whose rows referred to it.

## Context

The portfolio service will provide storage and simulation services to the
Home Office web application. It is currently a Rust 2024 binary crate with a
placeholder entry point and no dependencies. We need a consistent HTTP,
execution, and persistence architecture before implementing those capabilities.

We target a single-user service with one process owning a local SQLite database.
Requests may overlap with imports and simulations even with only one user.
Database access must not stall HTTP request processing, and CPU-intensive
simulation work must not monopolize the asynchronous runtime. Financial records
require explicit transaction boundaries, durable commits, and recoverable
schema changes.

This decision selects technologies and implementation constraints. It does not
add dependencies, endpoints, a database schema, or persistence code. API payloads,
financial numeric representations, and the simulation model remain separate
decisions.

## Decision Drivers

* A small HTTP JSON API that the existing browser application can consume
* Explicit, reviewable SQL with parameter binding and transaction support
* Integrated migrations and repeatable tests against real SQLite databases
* One asynchronous runtime for networking, timers, and database coordination
* Bounded concurrency and predictable failure handling
* Local deployment without a separate database server

## Considered Options

### HTTP API framework

1. Axum provides typed request extractors, ordinary async handler functions,
   explicit routing, and Tower middleware. Its router can be tested as a service
   without binding a network port. It is designed for Tokio and Hyper, so runtime
   independence is not a benefit. Tower's types and error handling require some
   learning, but provide reusable infrastructure for timeouts and tracing.
2. Actix Web also provides routing, extractors, middleware, and HTTP test
   utilities. Its Tokio-based worker model is a credible fit, and using it does
   not require adopting application actors. We prefer Axum's direct Tower
   integration and shared service model; there is no measured performance
   requirement that favors Actix Web here.
3. Rocket offers concise attribute-based routes, request guards, and integrated
   application conventions on Tokio. Those conventions are useful for a larger
   web application, but we prefer explicit router composition and Tower
   middleware for this small API.
4. Hyper alone provides HTTP primitives but leaves routing, extraction, and
   application error responses to us. That is additional infrastructure without
   a requirement for transport-level customization.

### Runtime and execution model

1. Tokio's multithreaded runtime fits Axum directly and supplies networking,
   timers, synchronization, shutdown signals, and async testing. It supports
   overlapping I/O without creating a thread per request. Cooperative scheduling
   still requires moving blocking or substantial CPU work off runtime workers.
2. Tokio's current-thread runtime could handle a small I/O-bound service, but
   offers less scheduling headroom for concurrent request processing. It does
   not make blocking handlers safe, and SQLite workers and blocking tasks would
   still use additional threads. We choose the multithreaded runtime without
   promising parallel writes or automatic simulation parallelism.
3. Smol or async-std can support async applications, but Axum does not target
   runtime independence. Switching would require a different integration or
   framework without a demonstrated benefit. We do not combine runtimes.
4. Synchronous HTTP with a bounded thread pool and rusqlite could serve this
   workload. It reduces async concepts but requires separate coordination for
   slow requests, cancellation, and background work. The async ecosystem is a
   better fit for the combined HTTP and persistence service.

### SQLite access library

1. SQLx provides parameterized SQL, typed row mapping, an async pool,
   transactions and savepoints, and versioned SQL migrations. Optional query
   macros check static queries against a schema at build time; ordinary query
   functions do not. Its SQLite driver delegates synchronous SQLite operations
   to background worker threads, rather than turning SQLite into nonblocking
   storage. Pooling and worker coordination carry more overhead than direct
   synchronous calls, but keep that boundary out of application code.
2. Rusqlite provides direct SQLite access, prepared statements, transactions,
   savepoints, and SQLite-specific facilities such as the online backup API.
   Synchronous tests with temporary or in-memory databases are straightforward.
   It does not supply an async connection pool or a versioned migration runner;
   we would select a migration library and arrange bounded blocking execution
   or a dedicated database worker. A wrapper such as tokio-rusqlite can provide
   that worker boundary, but pooling, migration integration, and transaction
   ownership across calls still need deliberate design. This remains a good
   alternative for a primarily synchronous service or deeper SQLite integration.
3. Diesel provides a typed query DSL, SQLite transactions, and migration
   tooling. Its standard SQLite connection is synchronous and would need a
   blocking execution boundary. The DSL and schema tooling add a second model
   to maintain when explicit SQL already expresses the queries we need.

## Decision Outcome

We will use Axum for an HTTP JSON API, Tokio's multithreaded runtime for async
execution, and SQLx with SQLite for persistence. SQLx's async pool and migration
runner outweigh the smaller direct-call surface of rusqlite for this service.
We will write explicit SQL rather than introduce an ORM.

At implementation time, select mutually compatible stable releases that support
the service's Rust toolchain and record resolved versions in the Cargo lockfile.
Enable only the required HTTP, Tokio, SQLite, and migration features. SQLx's pool
needs Tokio runtime support even though its underlying SQLite driver is
runtime-agnostic. Database TLS and other database drivers are unnecessary for a
local SQLite file.

### Application boundaries

Axum handlers validate transport inputs and map application results to HTTP
responses. Application operations own business rules and transaction boundaries;
repository functions own SQL and database-to-domain mapping. Domain calculations
remain independent of Axum and SQLx so they can be tested synchronously.

Construct one bounded `SqlitePool` at startup and share its cheap-to-clone handle
through typed Axum state. Do not open a new pool per request or wrap the entire
pool in a mutex. Repository operations participating in one transaction use the
same transaction connection, not an unrelated connection acquired from the pool.

Start with parameterized `query` and `query_as` functions and integration tests
for every repository operation. They avoid requiring a database during an
ordinary build, but SQL validity and row mappings are checked at runtime. If we
adopt `query!` or `query_as!` later, generate and commit SQLx offline metadata
from a disposable database built with the migrations, and check it in CI with
`cargo sqlx prepare --check`. Never use a personal database for query checking.

### Blocking and CPU work

Await SQLx directly; do not wrap its async API in `spawn_blocking`. For bounded
simulation or blocking import work, acquire a concurrency permit before
dispatching to `tokio::task::spawn_blocking`. Keep the permit inside the closure
until the work actually finishes, including when the requesting client leaves.
Limit admitted work as well as active work so overload cannot grow an unbounded
queue. Materialize required input and release database connections before
starting a long calculation.

A started blocking task cannot be aborted by dropping its future or timing out
the request. Such work needs cooperative cancellation and bounded inputs. A
dedicated CPU executor such as Rayon or a background job system is a future
decision if sustained simulation workloads justify it, not part of this choice.

### Migrations

Use SQLx's migration runner with ordered, versioned SQL files embedded in the
binary. Ensure the build tracks changes and additions to the migration directory
so an incremental build cannot ship stale embedded migrations. Applied migrations
are immutable; corrections use a new migration rather than changing a checksum.

Run migrations once during startup before serving requests or reporting
readiness. The deployment must ensure a single migration owner, with the old
service stopped before an upgrade; do not rely on database locking to coordinate
competing deployments. A migration failure or history mismatch stops startup
with an actionable diagnostic, not a partially initialized API.

Use the runner's transactional migrations for normal schema and data changes.
SQLite operations that cannot run in a transaction require an explicitly reviewed
maintenance procedure. Back up the database before upgrading, test both fresh
creation and upgrades, and prefer forward fixes. Do not run automatic down
migrations on startup or assume an older binary supports a newer schema.

Run migrations with foreign key enforcement off, as SQLite's procedure for
rebuilding a table requires, and end each migration's transaction with SQLite's
foreign key check so that any violation rolls the migration back. With
enforcement on, dropping a referenced table counts every row that refers to it
as a violation, even when the rebuilt table restores those parents, so even a
deferred check rejects a correct rebuild. The runner appends the check when it
applies a migration, so recorded checksums still cover only the migration
files, and it restores enforcement before the connection serves anything else.

### Transactions and concurrency

SQLite permits one writer at a time. Write-ahead logging (WAL) allows readers to
overlap with a writer, not multiple simultaneous writers. Use a small, explicitly
bounded pool; establish its size with workload tests, not SQLite's theoretical
connection limit. A larger pool adds threads and contention rather than write
capacity.

Configure and verify WAL mode for the database, foreign key enforcement on every
connection, `synchronous=FULL`, a finite busy timeout, and a finite pool
acquisition timeout. Keep database waits within the operation's overall deadline.
`FULL` favors durability of committed financial records over the lower commit
latency of `NORMAL`, which can lose recent commits after power failure. This
still depends on the filesystem and storage honoring synchronization requests.

Use explicit transactions for atomic multi-statement operations. Commit only
after validation and all writes succeed; on failure, roll back. SQLx's transaction
drop behavior is a rollback safety net, not a replacement for handling commit
errors. Never hold a write transaction during network calls or simulation work.

For read-modify-write operations that must acquire the writer position before
reading, use `BEGIN IMMEDIATE` through SQLx's managed transaction API. Deferred
read transactions can fail when promoted to writers, including
`SQLITE_BUSY_SNAPSHOT`; waiting alone cannot repair a stale snapshot. Roll back
and restart the entire operation only when it is safe to retry, with bounded
attempts. Never retry arbitrary writes after an ambiguous commit outcome.

Keep read transactions short as well: a long-lived reader can prevent WAL
checkpoints from completing. Retain automatic checkpointing initially and monitor
WAL growth, lock waits, and pool saturation. Revisit the database choice if
sustained write contention or multi-host access becomes a requirement.

### Error handling

Translate database errors into typed application failures at the repository
boundary, preserving internal causes without exposing SQLx types in HTTP
payloads. Classify SQLite failures by structured codes rather than message text.
Known constraint violations may represent domain conflicts; unexpected constraint
failures remain internal errors.

Use a consistent JSON error response with a stable code and a safe message.
Malformed requests map to `400`, invalid domain input to `422`, missing resources
to `404`, and recognized state conflicts to `409`. Exhausted database lock waits,
pool timeouts, and admission limits map to `503`; unexpected storage or programming
failures map to `500`. Apply the same response convention to extractor rejections
and fallible middleware, not only errors returned by handlers.

Log diagnostic context and a request identifier, but not credentials, SQL bind
values, financial records, or raw database errors in client responses. A request
timeout or disconnect does not prove that an in-flight write was rolled back.
Mutation contracts must establish idempotency or a way to reconcile an unknown
outcome before encouraging client retries.

### Testing

* Test domain calculations as pure functions with synthetic data.
* Test Axum routers through Tower's service utilities without binding a port,
  including validation, error responses, and middleware behavior.
* Run repository tests under Tokio against a unique temporary file database per
  test, applying the same migrations and connection settings as deployment.
* Test migrations from an empty database and representative prior schemas, a
  second migration run, failed migrations, and incompatible migration history.
* Verify commit and rollback behavior, constraints, writer contention, busy and
  pool timeouts, and concurrent reads using multiple connections to the same
  temporary database. Use synchronization rather than timing-only sleeps.
* Reserve in-memory SQLite for tests that do not depend on file locking, WAL, or
  persistence. Separate private in-memory connections do not share a database;
  a single-connection test cannot establish pooled concurrency behavior.
* Add startup, graceful shutdown, and backup-restore smoke tests when the service
  implementation exists. Keep the existing formatting, Clippy, and test gates.

### Deployment and recovery

Deploy one service process with a writable persistent directory on a local
filesystem for the database and its WAL and shared-memory sidecar files. A
container must mount that directory on persistent local storage, not keep data
in its disposable image layer. Do not place the live database on a network
filesystem or share it between replicas on different hosts.

Use SQLx's bundled SQLite build for consistent engine behavior across development
and deployment, accepting the native C build requirement and responsibility for
shipping SQLite updates. Verify the linked engine version in implementation
tests. Require SQLite 3.51.3 or newer, or a documented patched backport, to include
the [WAL-reset corruption fix](https://www.sqlite.org/wal.html#walreset).

Default to loopback access for local use. Nonlocal deployment requires explicit
authentication, TLS termination, and browser-origin protections before exposing
financial data; CORS alone is not authorization. ADR 0009 selects API
authentication for the initial loopback deployment. Nonlocal hosting,
including a reverse proxy or tunnel to loopback, requires a further decision
covering TLS, ingress, and proxy trust.

On shutdown, stop admitting work, drain requests within a deadline, cooperatively
stop background work, and close the pool before terminating Tokio. Do not assume
runtime shutdown forcibly stops already-running blocking tasks.

Backups must be transactionally consistent. Use SQLite-aware tooling with the
online backup API or `VACUUM INTO`, or stop all users and checkpoint and close the
database before copying it. Do not copy only a live database file or delete its
WAL to make a backup look self-contained. Protect backups like the original
financial records and verify restoration into a separate directory. A failed
upgrade requires a compatible binary and schema, or restoration of the verified
pre-upgrade backup with any resulting data loss understood.

## Consequences

Positive outcomes:

* HTTP and persistence share an async model without application-owned SQLite
  worker plumbing.
* Explicit SQL, transactions, and migrations keep data changes reviewable.
* Router and real-database tests can run without a deployed server.
* A local database avoids operating a separate database service.

Tradeoffs and risks:

* Tokio, Tower, and SQLx introduce async ownership and lifecycle concepts that
  a synchronous implementation would avoid.
* SQLite still performs blocking I/O on worker threads and serializes writers.
* Runtime query functions require integration coverage; adopting checked macros
  later adds schema metadata maintenance to the build workflow.
* Durable storage, WAL-aware backups, and migration recovery remain operational
  responsibilities even without a database server.
* SQLx supports other databases, but SQLite-specific SQL and migrations would
  still need revision if we move to PostgreSQL or another engine.

## Follow-up Decisions

* Endpoint contracts, API versioning, validation rules, and access controls
* Canonical persistence schema, monetary precision, imports, and data ownership
* Simulation execution limits, cancellation, and any persistent job model
* Concrete pool and timeout settings, deployment packaging, and backup scheduling

## References

* [Axum routing, state, middleware, and compatibility](https://docs.rs/axum/latest/axum/)
* [Actix Web documentation](https://actix.rs/docs/)
* [Rocket guide](https://rocket.rs/guide/v0.5/)
* [Tokio blocking work and cancellation](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
* [SQLx runtime and query APIs](https://docs.rs/sqlx/latest/sqlx/)
* [SQLx SQLite connection options](https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html)
* [SQLx embedded migrations](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)
* [Rusqlite SQLite APIs](https://docs.rs/rusqlite/latest/rusqlite/)
* [Diesel documentation](https://diesel.rs/guides/)
* [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
* [SQLite write-ahead logging](https://www.sqlite.org/wal.html)
* [SQLite online backup](https://www.sqlite.org/backup.html)
