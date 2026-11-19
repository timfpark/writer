---
title: Add a reproducible development container
description: Provide one shared development container that carries every toolchain the validation gate needs.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want one development container with every
pinned toolchain so that `tools/check` gives the same result on any machine and
in CI.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#development-container) adopts a
shared `.devcontainer/`. Hosts do not guarantee Node.js, which blocks Markdown
style lint and the webapp, and they may carry a different Rust or Python
version than CI.

## Scope

* Add `.devcontainer/devcontainer.json`, plus a Dockerfile only if features
  cannot express the setup.
* Pin the base image by digest and each feature by exact version.
* Install Bash, Python 3.9 or newer, rustup, and Node.js with npm, and record
  the Node.js version in one place.
* Run as a non-root user.
* Configure npm to use the `https://packagefeedproxy.microsoft.io/npm/` proxy
  and uv or pip to use the
  `https://packagefeedproxy.microsoft.io/pypi/simple/` proxy.
* Document port 8080 as reserved for the service; forward it only once the
  service exists.
* Keep credentials out of the image, the repository, and build arguments.
* Add container setup and host prerequisites to the root `README.md`, and
  update the root `AGENTS.md` repository map from planned to existing.
* Add guidance to the root and relevant existing nested `AGENTS.md` files
  requiring changes to toolchains, dependencies, or environment requirements
  to keep the devcontainer configuration, version pins, and setup documentation
  in sync in the same change. Require future subsystem guides to carry this
  guidance through the root guide's "Adding a subsystem" checklist.

## Acceptance criteria

* [ ] `devcontainer build` (or a VS Code "Rebuild Container") succeeds from a
  clean clone.
* [ ] Inside the container, `whoami` is not `root` and `tools/check` exits 0.
* [ ] `python3 --version`, `rustup --version`, `node --version`, and
  `npm config get registry` report the pinned versions and the proxy.
* [ ] No secret, token, or `.env` file appears in the image layers or the
  repository.
* [ ] The root and relevant existing nested `AGENTS.md` files require agents
  to update the devcontainer configuration, version pins, and setup documentation
  in the same change whenever toolchains, dependencies, or environment
  requirements change. The root guide's "Adding a subsystem" checklist requires
  this guidance in future subsystem guides.

## Prerequisites

None.
