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
decisions, backlog, and validation gate.

## Where to look

* [AGENTS.md](./AGENTS.md) holds repository-wide rules for contributors and
  coding agents.
* [ADR 0001](./docs/adrs/0001-monorepo-structure.md) records the repository
  layout, subsystem boundaries, and tooling baseline. The
  [ADR index](./docs/adrs/README.md) lists every decision.
* The [backlog](./docs/backlog/README.md) orders planned work.

## Development setup

You need Git, Bash, and Python 3.9 or newer. Validate any change from the
repository root:

```bash
tools/check
```

The development container, CI, and subsystem toolchains are pending work in
the [backlog](./docs/backlog/README.md); setup steps for them arrive with
those items.
