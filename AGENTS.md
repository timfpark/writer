---
title: Writer Agent Guide
description: Repository-wide rules, navigation, and validation for contributors and coding agents working on Writer
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
keywords:
  - monorepo
  - agents
  - repository guide
estimated_reading_time: 4
---

## Project at a glance

Writer is a constant pair writer: it asks questions, suggests other ideas, and
checks prose for quality and consistency. The repository is a monorepo with a
planned Rust service and a planned TypeScript/React web client.

Today the repository holds documentation and the validation gate only. No
subsystem code, development container, or CI exists yet.
[ADR 0001](./docs/adrs/0001-monorepo-structure.md) records the layout,
subsystem boundaries, and tooling baseline; the
[backlog](./docs/backlog/README.md) orders the work that implements it.

## Start here

1. Read this guide for rules that apply everywhere.
2. Before changing a subsystem, read its `AGENTS.md`. Subsystem guides are
   created with each subsystem's first deliverable.
3. Check [ADR 0001](./docs/adrs/0001-monorepo-structure.md) and the
   [ADR index](./docs/adrs/README.md) for the decisions that govern the change.
4. Find the work item and its priority in the
   [backlog index](./docs/backlog/README.md).
5. Validate with [tools/check](./tools/check) as described under
   [Validation](#validation).

## Subsystems

| Path       | Responsibility                                                     | Stack                  | Guide                         | Status  |
|------------|--------------------------------------------------------------------|------------------------|-------------------------------|---------|
| `service/` | Text storage, business rules, HTTP API, and the pair-writing agent | Rust, Cargo            | `service/AGENTS.md` (planned) | Planned |
| `webapp/`  | First client: editing and presenting pair-writer suggestions       | TypeScript, React, npm | `webapp/AGENTS.md` (planned)  | Planned |

Clients depend on the service only through its HTTP API and the checked-in
OpenAPI document under `service/`. The service never imports client code.
[ADR 0001](./docs/adrs/0001-monorepo-structure.md#subsystem-boundaries) defines
these boundaries and where tests, fixtures, and generated files belong.

## Repository map

| Path                  | Purpose                                                           | Status   |
|-----------------------|-------------------------------------------------------------------|----------|
| `README.md`           | Project overview and contributor setup                            | Existing |
| `AGENTS.md`           | Repository-wide rules for coding agents                           | Existing |
| `docs/adrs/`          | Architecture decisions, indexed by its README                     | Existing |
| `docs/backlog/`       | Prioritized planned work, indexed by its README                   | Existing |
| `tools/`              | Validation gate and its tests                                     | Existing |
| `.gitignore`          | Build output, secrets, and local-only data kept out of git        | Existing |
| `.editorconfig`       | Editor formatting conventions                                     | Existing |
| `.devcontainer/`      | Shared development container with every toolchain                 | Planned  |
| `.github/`            | CI workflow, Dependabot, and pull request template                | Planned  |
| `service/`, `webapp/` | Subsystems, each owning its manifest, lockfile, and toolchain pin | Planned  |

The [backlog](./docs/backlog/README.md) names the item that creates each
planned path.

## Coding agents and the product agent

This guide, the subsystem guides, and anything under `.github/` direct the
coding agents that build Writer. The pair-writing agent is product behavior:
its prompts belong in `service/prompts/`, its model integrations in service
code, and its evaluation cases in `service/evals/`. Never mix the two.

## Safety rules

* Never commit credentials, tokens, or `.env` files. Document each setting in
  a sanitized `*.example` file instead.
* Never commit real manuscripts or paste them into issues, pull requests,
  fixtures, or evaluation cases. Keep local material in the ignored `.local/`
  folder.
* Use synthetic prose, names, and identifiers in code, tests, fixtures, and
  evaluations.
* Regenerate generated files with their generator instead of editing them.
* Write repository commands to run non-interactively, check prerequisites,
  name the failing file or setting, and exit nonzero on failure.

## Working conventions

* Read the [backlog index](./docs/backlog/README.md) before starting planned
  work. When a story is finished, delete its row and its document as the index
  describes.
* Record consequential architectural choices in an ADR under `docs/adrs/`
  rather than in code comments or backlog notes, including choices that affect
  only one subsystem.
* Give every ADR and backlog work item a `subsystems` frontmatter field listing
  the subsystem folders it affects, or `repository` for repository-wide work.
  Keep the backlog index's Subsystems column and each subsystem guide's
  Governing decisions section in step with that field.
* Do not create empty subsystem folders or placeholders. Write planned paths
  and commands as code spans labeled planned, never as links.
* Add a dependency only when the change needs it.
* Install npm packages only through the
  `https://packagefeedproxy.microsoft.io/npm/` registry proxy. npm reads
  project settings only from the folder holding `package.json`, so give each
  npm project an `.npmrc` that sets the proxy.
* Repository tooling uses the Python standard library only. If a package
  becomes necessary, install it with `uv` through the
  `https://packagefeedproxy.microsoft.io/pypi/simple/` proxy.
* Keep Markdown frontmatter, relative links, heading hierarchy, and table
  formatting consistent with existing documentation.
* For all changes, create a branch and a conventional commit that fits a pull
  request to `main`. Scope a commit by subsystem (`service`, `webapp`) or
  shared area (`docs`, `ci`, `devcontainer`, `tools`), and omit the scope when
  a change spans several.

## Validation

Before every commit and before reporting work complete, run the gate from the
repository root:

```bash
tools/check
```

It needs Bash and Python 3.9 or newer, takes no arguments, and runs every
phase. It exits 0 when all phases pass, 1 when a phase fails, and 2 on a usage
or prerequisite error.

| Phase   | Checks                                                                                       | Status  |
|---------|----------------------------------------------------------------------------------------------|---------|
| `tools` | Unit tests for the repository tooling in `tools/tests/`                                      | Active  |
| `docs`  | Frontmatter, relative links and fragments, `subsystems` fields, and ADR and backlog indexing | Active  |
| `docs`  | Markdown style lint                                                                          | Planned |
| Each    | Subsystem formatting, lint, build, and tests                                                 | Planned |

Commit only after the gate exits zero on the final contents of the change,
including documentation-only changes. After any edit, rerun it. If a check
fails or cannot run, report the blocker and do not commit or claim validation
passed. An editor diagnostic, a focused test, or a single phase is not a
substitute.

## Adding a subsystem

Create the subsystem folder with its first deliverable, never as an empty
placeholder, and make these changes in the same pull request:

1. Add a `README.md` for people and an `AGENTS.md` guide with the subsystem's
   purpose, dependency boundaries, a Governing decisions section linking every
   ADR whose `subsystems` frontmatter names it, and exact setup, run, and check
   commands.
2. Update the subsystem table and repository map above and the project
   [README](./README.md).
3. Keep the subsystem's manifest, lockfile, toolchain pin, and `.env.example`
   inside its folder. For an npm project, add an `.npmrc` with the proxy.
4. Add its validation phase to [tools/check](./tools/check) in dependency
   order, with the service before the webapp.
5. Add its toolchain to `.devcontainer/` and its ecosystem to
   `.github/dependabot.yml` once those exist.
6. Give any local server a loopback port distinct from the service's 8080, and
   record it in the subsystem README.
