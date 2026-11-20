---
title: Writer
description: Monorepo for the Writer service and clients
author: Tim Park
ms.date: 2026-11-19
ms.topic: overview
keywords:
  - writer
  - monorepo
  - pair writing
---

## Overview

Writer is a writing application where an AI agent is always there with you,
pairing on the writing. It asks questions, suggests other ideas, and checks
prose for quality and consistency.

| Subsystem | Purpose                                        | Status  |
|-----------|------------------------------------------------|---------|
| Service   | Text storage, HTTP API, and the AI pair writer | Planned |
| Webapp    | The first client for the system                | Planned |

Neither subsystem exists yet. The repository currently holds its architecture
decisions, backlog, validation gate, and development container.

## Where to look

* [AGENTS.md](./AGENTS.md) holds repository-wide rules for contributors and
  coding agents.
* [ADR 0001](./docs/adrs/0001-monorepo-structure.md) records the repository
  layout, subsystem boundaries, and tooling baseline. The
  [ADR index](./docs/adrs/README.md) lists every decision.
* The [backlog](./docs/backlog/README.md) orders planned work.
* [tools/check](./tools/check) is the validation gate. Run it before every
  commit, as described under [Development setup](#development-setup).

## Development setup

Work either in the development container, which carries every pinned
toolchain, or on a host with the same prerequisites. Validate any change from
the repository root:

```bash
tools/check
```

### Development container

The [development container](./.devcontainer/devcontainer.json) provides Bash,
Git, Python 3.9 or newer, rustup with a default Rust toolchain, and Node.js
with npm. Each version is recorded once: the
[Dockerfile](./.devcontainer/Dockerfile) pins the base image by digest, which
fixes Python, Bash, and Git, and `devcontainer.json` pins each feature and the
Node.js and Rust versions exactly. The Dev Container CLI records each
feature's content digest in `devcontainer-lock.json`.

It runs as the non-root `vscode` user. The image configures the registry
proxies globally, so every user, shell, and folder in the container uses them
unless a project overrides them:

| Tool | Global config     | Proxy                                                |
|------|-------------------|------------------------------------------------------|
| npm  | `/etc/npmrc`      | `https://packagefeedproxy.microsoft.io/npm/`         |
| pip  | `/etc/pip.conf`   | `https://packagefeedproxy.microsoft.io/pypi/simple/` |
| uv   | `/etc/uv/uv.toml` | `https://packagefeedproxy.microsoft.io/pypi/simple/` |

To use it, you need Git and Docker, or another Docker-compatible engine, plus
one of these clients:

* In VS Code with the Dev Containers extension, open the repository and run
  **Dev Containers: Reopen in Container**. After changing `.devcontainer/`,
  run **Dev Containers: Rebuild Container**.
* With the [Dev Container CLI](https://github.com/devcontainers/cli), run from
  the repository root:

  ```bash
  devcontainer up --workspace-folder .
  devcontainer exec --workspace-folder . tools/check
  ```

Port 8080 is reserved for the service and port 5173 for the webapp's
development server; neither is forwarded until its subsystem exists. The
container holds no credentials; supply any secret at run time rather than in
the image, the repository, or build arguments.

### Host setup

On a host, `tools/check` needs Git, Bash, and Python 3.9 or newer. Later
phases need the container's other toolchains: rustup for the service, and
Node.js with npm for Markdown style lint and the webapp. Use the versions the
container pins, and configure npm and pip or uv to use the registry proxies
above.

Subsystem toolchains are pending work in the
[backlog](./docs/backlog/README.md); setup steps for them arrive with those
items.

### Continuous integration

The [CI workflow](./.github/workflows/ci.yml) builds the development container
and runs `tools/check` inside it on every pull request and every push to
`main`. A newer push to a pull request cancels that pull request's running
checks. The final `CI result` check passes only when every CI job succeeds,
so a failed, skipped, or cancelled job never reports success. The workflow
uses a read-only token, no repository secrets, and actions pinned to full
commit SHAs.

See the [missing guide](./does-not-exist.md).
