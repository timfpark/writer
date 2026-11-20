---
title: Writer service
description: How to build, run, configure, back up, and check the Writer service, a Rust Cargo workspace serving the HTTP API and storing the workspace
author: Tim Park
ms.date: 2026-11-20
ms.topic: overview
keywords:
  - service
  - rust
  - axum
  - openapi
  - storage
---

## Overview

The service stores text, applies business rules, serves the HTTP API, and will
run the pair-writing agent. Today it serves one operation,
`GET /api/v1/health`, behind a verified OpenAPI contract, and keeps the
workspace of folders and documents in a data folder on your machine, which the
workspace API (backlog 19) will expose. Coding agents start with
[AGENTS.md](./AGENTS.md); the architecture is recorded in
[ADR 0002](../docs/adrs/0002-service-architecture.md), the API conventions in
[ADR 0004](../docs/adrs/0004-api-conventions.md), the workspace model in
[ADR 0005](../docs/adrs/0005-workspace-model.md), and storage in
[ADR 0006](../docs/adrs/0006-storage-architecture.md).

The folder is a Cargo workspace whose members live under [crates/](./crates/):

| Crate                                      | Kind       | Responsibility                                                                            |
|--------------------------------------------|------------|-------------------------------------------------------------------------------------------|
| [writer-server](./crates/writer-server/)   | Executable | Reads configuration, binds the loopback listener, serves the router, and stops gracefully |
| [writer-api](./crates/writer-api/)         | Library    | Routes, handlers, transport types, problem details errors, and the OpenAPI document       |
| [writer-storage](./crates/writer-storage/) | Library    | The storage interface, its conformance suite, and the filesystem backend                  |
| [writer-domain](./crates/writer-domain/)   | Library    | Workspace types and rules: identifiers, titles, content, limits, and tree checks          |

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

The service listens on `127.0.0.1:8888` and logs to standard error. From
another terminal, check that it answers:

```bash
curl http://127.0.0.1:8888/api/v1/health
```

The response is `{"status":"ok"}`. In VS Code's development container, port
8888 is forwarded, so the same request also works from the host. With the Dev
Container CLI, which does not forward ports, run `curl` through
`devcontainer exec` instead.

Before it listens, the service opens its data folder, creating it on first use,
and logs where it is. Stop the service with Ctrl+C or `SIGTERM`. It stops accepting connections and
lets in-flight requests finish for up to 10 seconds.

| Exit status | Meaning                                                                                                                                  |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------|
| 0           | Stopped after a shutdown signal with every request finished                                                                              |
| 1           | The data folder could not be created, locked, or recovered, the port could not be bound, the server failed, or the drain deadline passed |
| 2           | A configuration setting is invalid; the log names it                                                                                     |

## Configuration

The service reads settings from its process environment and does not load
`.env` files. [.env.example](./.env.example) lists every setting.

| Variable          | Default                          | Effect                                                                                |
|-------------------|----------------------------------|---------------------------------------------------------------------------------------|
| `WRITER_PORT`     | `8888`                           | Port from 1 to 65535 to listen on. The address is always `127.0.0.1`.                 |
| `WRITER_DATA_DIR` | Per build, as [Data](#data) says | Folder holding Writer's data. A relative path resolves against the working directory. |

To run on another port, for example when another process already uses 8888:

```bash
WRITER_PORT=8889 cargo run -p writer-server
```

## Data

The service keeps your workspace in `workspace/` inside its data folder, as
ordinary directories and Markdown files that any editor, file manager, or
backup tool can read:

```text
<data>/workspace/
  .writer/            Writer's own files; leave them in place
    workspace.json    identifiers, exact titles, order, and names on disk
  The lighthouse/     a folder
    Chapter one.md    a document, holding exactly its Markdown
  Notes.md
```

Each folder is a directory and each document a `.md` file named after its
title. Characters that some systems reject become `_`, and a name that
another entry already uses, in any case, gets a numbered suffix such as
`Notes (2).md`; the exact title stays in `.writer/workspace.json`. Every
write goes through a temporary file and a rename, so a crash or power loss
leaves each document's old or new version, never a mix.

| Build                        | Default data folder                                                    |
|------------------------------|------------------------------------------------------------------------|
| Debug, such as `cargo run`   | `.local/data/` at the repository root, which Git ignores               |
| Release on macOS             | `~/Library/Application Support/Writer`                                 |
| Release on Linux             | `$XDG_DATA_HOME/writer`, or `~/.local/share/writer` when that is unset |
| Release on Windows, untested | `%LOCALAPPDATA%\Writer`                                                |

To keep the workspace somewhere visible, or in a folder a sync client backs
up, set `WRITER_DATA_DIR`:

```bash
WRITER_DATA_DIR="$HOME/Documents/Writer" cargo run -p writer-server
```

Only one service can use a data folder at a time; a second one exits with
status 1 naming the folder. Keep the folder on a local disk, since the lock
is unreliable on network file systems.

You can edit, add, or delete Markdown files with other tools while the
service runs. Writer reads the change the next time a client loads the tree
or the document, and a save never overwrites text it has not seen. Rename and
move items inside Writer, though: a file renamed or moved outside it returns
as a new item, losing its place in the order. Deleting `.writer/` loses
identifiers, exact titles, and order, but no text.

### Back up the data folder

1. Stop the service with Ctrl+C or `SIGTERM`, so nothing writes during the
   copy.
2. Copy the whole data folder, including the hidden `.writer/` directory,
   for example `cp -R .local/data ~/writer-backup-2026-11-20`.
3. To restore, stop the service, replace the data folder with the copy, and
   start the service again.

## Checks

The `service` phase of [tools/check](../tools/check), run from the repository
root, checks formatting, lints with warnings denied, builds, and runs every
test in the workspace with `--locked`. The tests include:

* Router tests for each documented response, run without binding a socket
* `writer-domain` tests of every workspace rule and limit, without storage
* The storage conformance suite, run against the filesystem backend in
  temporary directories, and tests of the backend's own rules: names on disk,
  edits made outside Writer, recovery after a failure or crash at every step
  of every write, and a child process killed while it writes
* Shared error mapping tests that send a synthetic marker and assert no
  response echoes it
* A smoke test that starts `writer-server` on an unused port with a temporary
  data folder, requests the health endpoint, sends `SIGTERM`, and requires
  exit status 0
* An [ADR 0004](../docs/adrs/0004-api-conventions.md#enforcement) conventions
  test of the generated document
* A contract freshness test that fails when [openapi.json](./openapi.json)
  differs from the routes

After changing a route or transport type, regenerate the contract from this
folder and commit it with the change:

```bash
UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi
```
