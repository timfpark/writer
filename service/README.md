---
title: Writer service
description: How to build, run, configure, and check the Writer service, a Rust Cargo workspace serving the HTTP API
author: Tim Park
ms.date: 2026-11-20
ms.topic: overview
keywords:
  - service
  - rust
  - axum
  - openapi
---

## Overview

The service stores text, applies business rules, serves the HTTP API, and will
run the pair-writing agent. Today it serves one operation,
`GET /api/v1/health`, behind a verified OpenAPI contract. Coding agents start
with [AGENTS.md](./AGENTS.md); the architecture is recorded in
[ADR 0002](../docs/adrs/0002-service-architecture.md) and the API conventions
in [ADR 0004](../docs/adrs/0004-api-conventions.md).

The folder is a Cargo workspace whose members live under [crates/](./crates/):

| Crate                                    | Kind       | Responsibility                                                                            |
|------------------------------------------|------------|-------------------------------------------------------------------------------------------|
| [writer-server](./crates/writer-server/) | Executable | Reads configuration, binds the loopback listener, serves the router, and stops gracefully |
| [writer-api](./crates/writer-api/)       | Library    | Routes, handlers, transport types, problem details errors, and the OpenAPI document       |

[openapi.json](./openapi.json) is the API contract of record. It is generated
from `writer-api`, so never edit it by hand.

## Setup

Install [rustup](https://rustup.rs/). The first Cargo command in this folder
installs the toolchain that [rust-toolchain.toml](./rust-toolchain.toml)
pins, with `clippy` and `rustfmt`. The
[development container](../.devcontainer/devcontainer.json) already carries
the same version. Cargo downloads crates from crates.io directly; unlike npm
and PyPI, no organizational registry proxy is required.

## Run the service

From this folder:

```bash
cargo run -p writer-server
```

The service listens on `127.0.0.1:8080` and logs to standard error. From
another terminal, check that it answers:

```bash
curl http://127.0.0.1:8080/api/v1/health
```

The response is `{"status":"ok"}`. In VS Code's development container, port
8080 is forwarded, so the same request also works from the host. With the Dev
Container CLI, which does not forward ports, run `curl` through
`devcontainer exec` instead.

Stop the service with Ctrl+C or `SIGTERM`. It stops accepting connections and
lets in-flight requests finish for up to 10 seconds.

| Exit status | Meaning                                                                      |
|-------------|------------------------------------------------------------------------------|
| 0           | Stopped after a shutdown signal with every request finished                  |
| 1           | The port could not be bound, the server failed, or the drain deadline passed |
| 2           | A configuration setting is invalid; the log names it                         |

## Configuration

The service reads settings from its process environment and does not load
`.env` files. [.env.example](./.env.example) lists every setting.

| Variable      | Default | Effect                                                                |
|---------------|---------|-----------------------------------------------------------------------|
| `WRITER_PORT` | `8080`  | Port from 1 to 65535 to listen on. The address is always `127.0.0.1`. |

To run on another port, for example beside a service already using 8080:

```bash
WRITER_PORT=8081 cargo run -p writer-server
```

## Checks

The `service` phase of [tools/check](../tools/check), run from the repository
root, checks formatting, lints with warnings denied, builds, and runs every
test in the workspace with `--locked`. The tests include:

* Router tests for each documented response, run without binding a socket
* Shared error mapping tests that send a synthetic marker and assert no
  response echoes it
* A smoke test that starts `writer-server` on an unused port, requests the
  health endpoint, sends `SIGTERM`, and requires exit status 0
* An [ADR 0004](../docs/adrs/0004-api-conventions.md#enforcement) conventions
  test of the generated document
* A contract freshness test that fails when [openapi.json](./openapi.json)
  differs from the routes

After changing a route or transport type, regenerate the contract from this
folder and commit it with the change:

```bash
UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi
```
