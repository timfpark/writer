---
title: Writer service
description: How to build, run, configure, back up, and check the Writer service, a Rust Cargo workspace serving the HTTP API and storing the workspace
author: Tim Park
ms.date: 2026-11-27
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
run the pair-writing agent. Today it keeps the workspace of folders and
documents in a data folder on your machine and serves it through the
workspace API, behind a verified OpenAPI contract. Coding agents start with
[AGENTS.md](./AGENTS.md); the architecture is recorded in
[ADR 0002](../docs/adrs/0002-service-architecture.md), the API conventions in
[ADR 0004](../docs/adrs/0004-api-conventions.md), the workspace model in
[ADR 0005](../docs/adrs/0005-workspace-model.md), and storage in
[ADR 0006](../docs/adrs/0006-storage-architecture.md).

The folder is a Cargo workspace whose members live under [crates/](./crates/):

| Crate                                      | Kind       | Responsibility                                                                                                                              |
|--------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| [writer-server](./crates/writer-server/)   | Executable | Reads configuration, binds the loopback listener, serves the router, and stops gracefully                                                   |
| [writer-api](./crates/writer-api/)         | Library    | Routes, handlers, transport types, problem details errors, SSE streams, and OpenAPI document                                                |
| [writer-agent](./crates/writer-agent/)     | Library    | Pair-writer provider interface, 19,000-word reading assembly, prompt templates in [prompts/](./prompts/), and Ollama and scripted providers |
| [writer-storage](./crates/writer-storage/) | Library    | The storage interface, its conformance suite, and the filesystem backend                                                                    |
| [writer-domain](./crates/writer-domain/)   | Library    | Workspace types and rules: identifiers, titles, content, limits, and tree checks                                                            |

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

| Variable                                  | Default                          | Effect                                                                                                                     |
|-------------------------------------------|----------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `WRITER_PORT`                             | `8888`                           | Port from 1 to 65535 to listen on. The address is always `127.0.0.1`.                                                      |
| `WRITER_DATA_DIR`                         | Per build, as [Data](#data) says | Folder holding Writer's data. A relative path resolves against the working directory.                                      |
| `WRITER_PAIR_WRITER`                      | `ollama`                         | Pair-writer provider: `ollama`, `scripted` (deterministic replies), or `none` (disabled).                                  |
| `OLLAMA_HOST`                             | `http://127.0.0.1:11434`         | Local Ollama server URL when using `ollama`. Use `http://host.docker.internal:11434` from the dev container.               |
| `WRITER_CONVERSATION_MODEL`               | `gemma4:31b-mlx`                 | Conversation model requested from Ollama, defaulting to [ADR 0010](../docs/adrs/0010-pair-writing-models.md)'s choice.     |
| `WRITER_SCRIPTED_MODE`                    | `ready`                          | Scripted provider mode: `ready`, `missing-model` (reports not ready and returns 503), or `fail-mid-stream`.                |
| `WRITER_SCRIPTED_FIRST_TOKEN_MS`          | `2000`                           | Base delay in milliseconds before the first token on a first read.                                                         |
| `WRITER_SCRIPTED_MS_PER_1000_WORDS`       | `3000`                           | Additional first-read delay in milliseconds per further 1,000 words beyond the first 1,000.                                |
| `WRITER_SCRIPTED_FOLLOWUP_FIRST_TOKEN_MS` | `450`                            | Delay in milliseconds before the first token on a follow-up turn.                                                          |
| `WRITER_SCRIPTED_TOKENS_PER_SEC`          | `30`                             | Streaming rate in tokens per second (`0` streams without delay).                                                           |
| `WRITER_SCRIPTED_REVIEW_MS`               | `1200`                           | Delay in milliseconds before a scripted background review returns findings.                                                |

To run on another port, for example when another process already uses 8888:

```bash
WRITER_PORT=8889 cargo run -p writer-server
```

### Run with the local Ollama model

By default (`WRITER_PAIR_WRITER=ollama`), the service streams chat replies from
a local Ollama instance using [ADR 0010](../docs/adrs/0010-pair-writing-models.md)'s
`gemma4:31b-mlx` model and the
[conversation-grounded](./prompts/conversation-grounded.txt) prompt. If Ollama
is stopped or the model is not installed, the service still starts cleanly so
writing and saving keep working, and `GET /api/v1/pair-writer` reports what is
missing.

1. Install [Ollama](https://ollama.com/) on the host machine and make sure it
   is running on loopback (`http://127.0.0.1:11434`):

   ```bash
   ollama --version
   ollama serve
   ```

   If the Ollama desktop application is already running, `ollama serve` is not
   needed.

2. Pull ADR 0010's default conversation model (or another tier model from ADR
   0010 if your machine has less memory, passing its name in
   `WRITER_CONVERSATION_MODEL`):

   ```bash
   ollama pull gemma4:31b-mlx
   ```

3. Start the Writer service from `service/`. On the host:

   ```bash
   cargo run -p writer-server
   ```

   Inside the development container, point `OLLAMA_HOST` at the host's Ollama
   server through Docker Desktop:

   ```bash
   OLLAMA_HOST=http://host.docker.internal:11434 cargo run -p writer-server
   ```

4. Check readiness from a second terminal:

   ```bash
   curl http://127.0.0.1:8888/api/v1/pair-writer
   ```

   Expect `"ready":true`, `"provider":"ollama"`, and `"model":"gemma4:31b-mlx"`.

5. Ask each of the Chat tab's three starter prompts against a synthetic passage
   (or start the webapp with `npm run dev` in `webapp/` and click each starter
   button in the Chat tab):

   ```bash
   passage='The keeper climbed the stairs twice before lighting the lamp. Cold rain rattled against the window pane while the harbor bells counted nine.'
   for prompt in \
     "Give me some ideas about how I can improve this text" \
     "How can I further develop this text?" \
     "What other ideas should I explore?"; do
     echo "=== $prompt ==="
     curl -sS -N -X POST http://127.0.0.1:8888/api/v1/pair-writer/replies \
       -H 'Content-Type: application/json' \
       -d "$(python3 -c 'import json, sys; print(json.dumps({
         "message": sys.argv[1],
         "document": {
           "documentId": "c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a",
           "title": "Harbor Scene",
           "content": sys.argv[2]
         }
       }))' "$prompt" "$passage")"
     echo
   done
   ```

   Each response streams `delta` events containing advice-only notes quoting
   the synthetic passage verbatim, followed by a `done` event carrying
   `"model":"gemma4:31b-mlx"`,
   `"promptVersion":"conversation-grounded@c0a3c0b9f874"`, the sources read,
   and Ollama's timing and token `metrics`.

### Run with the scripted pair writer

To try ADR 0012's Chat tab without Ollama or a local model, select the
deterministic scripted pair writer (or pass `WRITER_PAIR_WRITER=none` to start
with no pair writer configured):

```bash
WRITER_PAIR_WRITER=scripted cargo run -p writer-server
```

Check readiness from another terminal:

```bash
curl http://127.0.0.1:8888/api/v1/pair-writer
```

The scripted provider paces replies like ADR 0010's local model by default
(about 2 seconds plus 3 seconds per further 1,000 words on a first read, under
a second on a follow-up, and 30 tokens a second). To exercise the setup notice
or mid-stream failure states, set `WRITER_SCRIPTED_MODE=missing-model` or
`WRITER_SCRIPTED_MODE=fail-mid-stream`.

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

## Walk through the workspace API

The workspace API lists, creates, reads, saves, renames, moves, and deletes
folders and documents, as [ADR 0005](../docs/adrs/0005-workspace-model.md#operations)
defines. This walkthrough drives it with `curl` against a scratch data folder,
so your own workspace stays untouched. Every title and sentence is synthetic.

1. Start the service from this folder with a scratch data folder:

   ```bash
   WRITER_DATA_DIR=../.local/walkthrough cargo run -p writer-server
   ```

2. In a second terminal, also in this folder, name the API and the scratch
   workspace. Each request below prints the response body followed by its
   status code.

   ```bash
   api=http://127.0.0.1:8888/api/v1
   data=../.local/walkthrough/workspace
   ```

3. Create the `The lighthouse` folder at the top level. The client chooses
   each new item's identifier, a lowercase UUID.

   ```bash
   curl -sS -w ' %{http_code}\n' -X POST "$api/folders" \
     -H 'Content-Type: application/json' \
     -d '{"folderId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","parentId":null,"beforeId":null,"title":"The lighthouse"}'
   ls "$data"
   ```

   The response is the folder with status `201`, and `ls` lists
   `The lighthouse`. Sending the same request again returns `200` and
   changes nothing.

4. Create the empty `Chapter one` document inside it:

   ```bash
   curl -sS -w ' %{http_code}\n' -X POST "$api/documents" \
     -H 'Content-Type: application/json' \
     -d '{"documentId":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","beforeId":null,"title":"Chapter one"}'
   ls "$data/The lighthouse"
   ```

   The response carries `"revision":"e3b0c44298fc1c149afbf4c8996fb924"`, the
   revision of empty content, and `ls` lists `Chapter one.md`.

5. Save content, naming the revision your edits started from:

   ```bash
   curl -sS -w ' %{http_code}\n' -X PUT "$api/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/content" \
     -H 'Content-Type: application/json' \
     -d '{"markdown":"The keeper climbed the stairs twice before lighting the lamp.\n","baseRevision":"e3b0c44298fc1c149afbf4c8996fb924"}'
   cat "$data/The lighthouse/Chapter one.md"
   ```

   The response is `200` with the new revision
   `50a52a64cb33d03e10dc09540168aec7`, and the file holds exactly the
   sentence.

6. Save different text from the same, now stale, revision, as a second tab
   would:

   ```bash
   curl -sS -w ' %{http_code}\n' -X PUT "$api/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/content" \
     -H 'Content-Type: application/json' \
     -d '{"markdown":"The keeper waited for the tide.\n","baseRevision":"e3b0c44298fc1c149afbf4c8996fb924"}'
   cat "$data/The lighthouse/Chapter one.md"
   ```

   The response is a `409` problem with code `conflict`, and the file still
   holds the sentence from step 5.

7. Rename the document:

   ```bash
   curl -sS -w ' %{http_code}\n' -X PUT "$api/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/title" \
     -H 'Content-Type: application/json' \
     -d '{"title":"Chapter 1"}'
   ls "$data/The lighthouse"
   ```

   The response is `200` with the same identifier and revision, and `ls`
   lists `Chapter 1.md`.

8. Move it to the end of the top level:

   ```bash
   curl -sS -w ' %{http_code}\n' -X PUT "$api/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/position" \
     -H 'Content-Type: application/json' \
     -d '{"parentId":null,"beforeId":null}'
   ls "$data" "$data/The lighthouse"
   curl -sS -w ' %{http_code}\n' "$api/workspace"
   ```

   The response is `200` with `"parentId":null`. `ls` lists `Chapter 1.md`
   beside `The lighthouse`, which is now empty, and the workspace lists the
   folder, then the document.

9. Delete the document and the folder:

   ```bash
   curl -sS -w ' %{http_code}\n' -X DELETE "$api/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a"
   curl -sS -w ' %{http_code}\n' -X DELETE "$api/folders/3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3"
   ls -A "$data"
   ```

   Each deletion prints `204`, and `ls -A` lists only Writer's own
   `.writer` directory. Deleting either again returns a `404` problem.

10. Stop the service with Ctrl+C, then remove the scratch folder with
    `rm -rf ../.local/walkthrough`.

In the development container the same commands work in its terminal. From
the host, VS Code forwards port 8888, so the `curl` commands work there too,
while the data folder stays inside the container.

## Checks

The `service` phase of [tools/check](../tools/check), run from the repository
root, checks formatting, lints with warnings denied, builds, and runs every
test in the workspace with `--locked`. The tests include:

* Router tests for each documented response, run without binding a socket
  against the filesystem backend in a temporary directory, which also
  assert that a synthetic marker sent in titles, content, chat messages,
  and context documents appears in no problem response and no log line
* `writer-agent` tests of 19,000-word reading assembly, prompt loading and
  prefix-cached message layout, the Ollama provider against a local fake
  Ollama API (streaming, metrics, readiness, failures, timeouts, and TCP
  cancellation on disconnect), and the scripted provider's pacing, fault
  modes, and cancellation
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
