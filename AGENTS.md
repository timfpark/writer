---
title: Writer Agent Guide
description: Monorepo layout, shared conventions, and validation routing for contributors and coding agents working on any portfolio subsystem
author: Tim Park
ms.date: 2026-11-18
ms.topic: reference
keywords:
  - monorepo
  - agents
  - repository guide
estimated_reading_time: 3
---

## Project at a glance

Writer stores, and helps writers write prose.
The repository is a monorepo of subsystems that share one set of architecture
decisions, one backlog, and one development container. The Rust service owns
storage, business rules, and the HTTP API; every other subsystem is a client of
that API.
[ADR 0010](./docs/adrs/0010-monorepo-layout-and-subsystem-boundaries.md)
records the layout, the shared Cargo workspace, CI, and the development
container.

## Subsystems

Before changing files in a subsystem, read its guide. A subsystem guide holds
the architecture, rules, governing decisions, and validation commands for that
subsystem; this file holds only what applies everywhere.

| Path       | Subsystem                       | Stack                  | Guide                                    | Status                                                                                      |
|------------|---------------------------------|------------------------|------------------------------------------|---------------------------------------------------------------------------------------------|
| `service/` | Storage and HTTP API | Rust                   | [service/AGENTS.md](./service/AGENTS.md) (planned)| Active                                                                                      |
| `webapp/`  | Browser application             | TypeScript, React, npm | [webapp/AGENTS.md](./webapp/AGENTS.md) (planned)  | Sign-in, all nine destinations, ledger editing, and setup active                            |
                                                                               |

## Repository map

| Path                       | Purpose                                                                  |
|----------------------------|--------------------------------------------------------------------------|
| `Cargo.toml`, `Cargo.lock` | Cargo workspace, shared dependency versions, and lockfile for Rust code  |
| `rust-toolchain.toml`      | Rust version and components for hosts, the container, and workflows      |
| `docs/adrs/`               | Architecture decisions for every subsystem, indexed by its README        |
| `docs/backlog/`            | Planned work and open decisions, indexed by its README                   |
| `docs/lifeof/`             | Step-by-step data lifecycle walkthroughs, indexed by its README (planned) |
| `docs/models/`             | Canonical data models, indexed by its README                             |
| `tools/`                   | Validation runner and selector, worktrees, audits, Auth0, local bring-up |
| `.markdownlint*`           | Markdown lint rules and the files they cover                             |
| `.npmrc`                   | npm registry proxy for repository-level `npx` tools                      |
| `.github/workflows/`       | CI entry point `ci.yml`, a reusable workflow per stack, and Markdown     |
| `.github/dependabot.yml`   | Dependency updates for each ecosystem                                    |
| `.devcontainer/`           | One development container carrying every subsystem's toolchain           |
| `target/`                  | Cargo build output, ignored                                              |

## Working conventions

* Read the [backlog index](./docs/backlog/README.md) before starting planned
  work. When a story is finished, delete its row and its document as the index
  describes.
* Record consequential architectural choices in an ADR under `docs/adrs/`
  rather than in code comments or backlog notes, including choices that affect
  only one subsystem.
* Give every ADR and backlog work item a `subsystems` frontmatter field listing
  the subsystems it affects, by folder name. When the field changes, update the
  backlog index's Subsystems column for a work item, or the Governing decisions
  section of each existing subsystem guide that an ADR adds or drops.
* Integrate subsystems only through the service's HTTP API and its checked-in
  OpenAPI description. The CLI's offline `portfolio admin` commands are the one
  exception: ADR 0009 builds them on the service's application and storage
  crates.
* Use synthetic names, identifiers, and figures in code, tests, and fixtures.
  Never copy real account details or credentials into the repository.
* Add a dependency only when the change needs it.
* Install npm packages only through the
  `https://packagefeedproxy.microsoft.io/npm/` registry proxy. npm reads
  project settings only from the folder holding `package.json`, so give each
  npm project an `.npmrc` that sets the proxy, and list the project's
  Dependabot entry under the `npm-proxy` registry.
* Keep Markdown frontmatter, relative links, heading hierarchy, and table
  formatting consistent with existing documentation.
* For all changes, create a branch and conventional commit that fits into the
  team's PR to main workflow. Scope a commit by subsystem (`service`, `cli`,
  `webapp`, `agent`) or shared area (`docs`, `ci`, `devcontainer`, `tools`),
  and omit the scope when a change spans several.

## Validation

Before every commit and before reporting work complete, run the affected
gate from the repository root, from a host terminal or inside the
development container:

```bash
tools/check
```

Commit only after it exits zero on the final contents of the change. This
applies to every change, including documentation-only changes. After any
edit, rerun the gate. If a check fails or cannot run, report the blocker and
do not commit or claim validation passed. An editor diagnostic, a focused
test, or a named phase is not a substitute.

## Adding a subsystem

Create the subsystem folder with its first deliverable, never as an empty
placeholder, and make these changes in the same pull request:

1. Add a `README.md` for people and an `AGENTS.md` guide with the subsystem's
   architecture rules, validation commands, and a Governing decisions section
   linking every ADR whose `subsystems` frontmatter names it.
2. Update the subsystem table above and the project [README](./README.md).
3. For a Rust subsystem, add its `<subsystem>/crates/*` glob to the workspace
   members in [Cargo.toml](./Cargo.toml). Otherwise, keep its manifest and
   lockfile inside its folder.
4. Add its validation phase to [tools/check](./tools/check) in dependency
   order and rules for its paths to [tools/select-checks](./tools/select-checks).
   In [ci.yml](./.github/workflows_disabled/ci.yml), add a job that calls a reusable
   workflow for its stack when the selector chooses that phase, and add the
   job to the `CI result` needs and to [tools/ci-result](./tools/ci-result).
5. Add its toolchain to the [development container](./.devcontainer/devcontainer.json)
   and its ecosystem to [dependabot.yml](./.github/dependabot.yml).
6. Give any local server a loopback port distinct from the service's 8080, and
   record it in the subsystem README.
