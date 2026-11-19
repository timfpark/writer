---
title: "ADR 0001: Monorepo structure, agent navigation, and tooling baseline"
description: Repository layout, subsystem boundaries, agent discoverability, and the development and automation baseline for Writer
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
status: Accepted
subsystems:
  - repository
  - service
  - webapp
keywords:
  - adr
  - monorepo
  - agents
  - tooling
estimated_reading_time: 12
---

## Status

Accepted on 2026-11-19.

[ADR 0002](./0002-service-architecture.md) settles the service decisions this
record defers: the HTTP framework, internal crate responsibilities, and how the
OpenAPI contract is produced and verified.

## Context

Writer is a constant pair writer: it asks questions, suggests other ideas, and
checks prose for quality and consistency. The [project README](../../README.md)
plans two subsystems, a service and a web client. Neither exists yet.

The initial scaffold held a root agent guide, an ADR index, a backlog, and an
empty `tools/check`. The agent guide was inherited from an earlier project and
described a Cargo workspace, CI workflows, a development container, a CLI, and
an ADR 0010, none of which existed. Coding agents read that guide as fact, so
an unverified claim there becomes a defect in every change an agent makes.

Contributors and coding agents need one structure they can navigate without
chat history, boundaries they can respect, and a validation gate whose result
means something. This decision sets those foundations. Product architecture,
such as the service's HTTP framework, storage engine, or agent framework, is
left to later ADRs.

## Decision

### Repository layout

Use top-level subsystem folders, `service/` and `webapp/`, rather than an
`apps/` and `packages/` layout. Each subsystem folder is self-contained: it
owns its manifest, lockfile, toolchain pin, tests, fixtures, configuration
examples, README, and scoped `AGENTS.md`. Repository-wide documentation lives
in `docs/` and repository-wide tooling in `tools/`.

A subsystem folder is created with its first deliverable, never as an empty
placeholder. No CLI, shared-library, or separate agent subsystem is planned.
Internal service crates are part of the service, not separate subsystems.

The tree below marks each path as existing or planned. A planned path names
the backlog item or subsystem deliverable that creates it.

```text
writer/
  .editorconfig                existing   editor formatting conventions
  .gitignore                   existing   build output, secrets, local-only data
  AGENTS.md                    existing   root coding-agent guide
  README.md                    existing   project overview for people
  docs/
    adrs/                      existing   decision records, indexed by README.md
    backlog/                   existing   prioritized work, indexed by README.md
    previous-work/             existing   earlier-project designs, not validated
  tools/
    check                      existing   validation gate
    check_docs.py              existing   docs phase of the gate
    tests/                     existing   unit tests for repository tooling
  .devcontainer/               existing   shared development container
  .github/
    workflows/ci.yml           planned    backlog 3
    dependabot.yml             planned    backlog 4
    pull_request_template.md   planned    backlog 4
  .markdownlint-cli2.jsonc     planned    backlog 5
  tools/package.json           planned    backlog 5, pins Markdown lint
  service/                     planned    backlog 6
    AGENTS.md, README.md
    Cargo.toml, Cargo.lock, rust-toolchain.toml
    crates/                    internal Cargo workspace members
    openapi.*                  API contract of record
    prompts/                   planned    backlog 12, pair-writing agent prompts
    evals/                     planned    backlog 12, agent evaluation cases
    .env.example
  webapp/                      planned    backlog 7
    AGENTS.md, README.md
    package.json, package-lock.json, .npmrc
    src/api/generated/         client generated from the service contract
    .env.example
```

Change to an `apps/` and `packages/` layout when either trigger occurs:

* Two or more subsystems need the same library code that cannot travel
  through the HTTP API contract.
* A third deployable subsystem is added.

Use a Cargo workspace inside `service/` from its first deliverable.
`service/Cargo.toml` is a virtual workspace manifest, with member crates under
`service/crates/`. The workspace shares one `Cargo.lock`, toolchain pin, and
`target/` directory, all inside `service/`. Internal crates set
`publish = false`.

Keep the executable crate thin: it assembles focused library crates and starts
the service. Give each library crate one cohesive responsibility, a narrow
public API, and explicit, acyclic dependencies on other internal crates. Add
crates for behavior being delivered, not empty placeholders for future layers.
The first deliverable includes the executable and at least one internal
library crate so modularity and single responsibility guide the service from
the start.

Move the Cargo workspace to the repository root when a second Rust subsystem
is added; internal crates alone do not trigger that move or a change to the
top-level subsystem layout.

### Subsystem boundaries

| Subsystem | Responsibility                                                                                             | Stack                  | May depend on                                  |
|-----------|------------------------------------------------------------------------------------------------------------|------------------------|------------------------------------------------|
| `service` | Text storage, business rules, the HTTP API, and the pair-writing agent (prompts, model calls, evaluations) | Rust, Cargo            | Its own crates and external services           |
| `webapp`  | The first client: editing, presenting pair-writer suggestions, and calling the service                     | TypeScript, React, npm | The service only through its HTTP API contract |

Dependencies point from clients to the service. The service never imports
client code, and clients never import service source, read its storage, or
call model providers directly.

The checked-in OpenAPI document under `service/` is the API contract of
record. A later service ADR decides whether it is written by hand or emitted
from service code; either way, the service's checks must fail when the
document and the implementation disagree. The webapp's API client is generated
from that document into `webapp/src/api/generated/`, committed, and checked
for freshness. Generated files are never edited by hand.

### Artifact locations

| Artifact                          | Location                                                                 | Kind                   |
|-----------------------------------|--------------------------------------------------------------------------|------------------------|
| Unit and integration tests        | Inside each subsystem, following its stack's convention                  | Source                 |
| Synthetic test fixtures           | Inside each subsystem, next to the tests that use them                   | Source                 |
| AI evaluation cases               | `service/evals/`                                                         | Source, synthetic only |
| Agent prompts                     | `service/prompts/`                                                       | Source                 |
| Configuration examples            | `<subsystem>/.env.example` or another `*.example` file                   | Source, sanitized      |
| Repository-wide developer scripts | `tools/`                                                                 | Source                 |
| Subsystem scripts                 | The stack's own runner, such as Cargo commands or `package.json` scripts | Source                 |
| Repository-wide documentation     | `docs/`, with ADRs and backlog items indexed by their README files       | Source                 |
| Subsystem documentation           | `<subsystem>/README.md` for people, `<subsystem>/AGENTS.md` for agents   | Source                 |
| API contract                      | `service/openapi.*`                                                      | Committed, verified    |
| Generated API client              | `webapp/src/api/generated/`                                              | Generated, committed   |
| Build output and dependencies     | `target/`, `node_modules/`, `dist/`, `coverage/`                         | Generated, ignored     |
| Real secrets and local settings   | `.env`, `.env.*` except examples                                         | Local only, ignored    |
| Local manuscripts and scratch     | `.local/`                                                                | Local only, ignored    |

Cross-subsystem end-to-end tests are deferred until both subsystems exist and
a story needs them; that story chooses their location.

### Agent discoverability

Agents and people follow one navigation path:

1. The root `README.md` gives the product overview and links to `AGENTS.md`,
   this ADR, the backlog, and the validation gate.
2. The root `AGENTS.md` holds only repository-wide rules: the subsystem table,
   the repository map, safety rules, conventions, and validation. It links each
   subsystem guide once that guide exists.
3. Each `<subsystem>/AGENTS.md` holds that subsystem's purpose, dependency
   boundaries, governing decisions, and exact setup, run, and check commands.
4. The [ADR index](./README.md) and [backlog index](../backlog/README.md)
   list every decision and every item of planned work.

GitHub Copilot, including the coding agent, reads `AGENTS.md` files natively,
and nested guides apply to their folders. A separate
`.github/copilot-instructions.md` would duplicate independently maintained
rules, so it is rejected. Revisit if a tool in use stops reading `AGENTS.md`;
the fix then is a one-line pointer to `AGENTS.md`, not a copy of it.

Commands and paths that do not exist yet are written in code spans and labeled
planned, never as links. `tools/check` fails on broken relative links, which
keeps that rule enforced.

### Coding agents and the product agent

`AGENTS.md` files, and anything under `.github/`, guide the coding agents that
develop Writer. The pair-writing agent is product behavior. Its prompts live in
`service/prompts/`, its model integrations in service code, and its evaluation
cases in `service/evals/`. Product prompts are never placed in coding-agent
guidance, and coding-agent guidance never becomes product prompts. Choosing an
agent framework or model provider is deferred to a later service ADR, which
[backlog 10](../backlog/0010-agent-architecture-adr.md) records.

### Safety rules

* Credentials never enter the repository, container images, or logs. Use
  sanitized `*.example` files that list each setting with a placeholder.
* Real manuscripts are user content. Keep them out of the repository, fixtures,
  evaluation cases, issues, and pull requests; use `.local/` for local work.
* Fixtures and evaluation cases use synthetic prose written for the purpose.
* Commit generated artifacts only where the table above says to, and
  regenerate them rather than editing them.
* Repository commands are non-interactive, check their prerequisites, print
  diagnostics that name the failing file or setting, and exit nonzero on
  failure.

### Development and automation baseline

| Area                                | Decision | Location                                             | Delivered by                                           |
|-------------------------------------|----------|------------------------------------------------------|--------------------------------------------------------|
| Validation gate, docs phase         | Adopt    | `tools/check`, `tools/check_docs.py`                 | This decision                                          |
| Markdown style lint                 | Adopt    | `.markdownlint-cli2.jsonc`, `tools/check` docs phase | [Backlog 5](../backlog/0005-markdown-style-lint.md)    |
| Development container               | Adopt    | `.devcontainer/`                                     | Backlog 2                                              |
| GitHub Actions CI                   | Adopt    | `.github/workflows/ci.yml`                           | [Backlog 3](../backlog/0003-continuous-integration.md) |
| Selective checks                    | Reject   | Not applicable                                       | Not planned                                            |
| Reusable workflows                  | Reject   | Not applicable                                       | Not planned                                            |
| Runtime and toolchain pinning       | Adopt    | Each subsystem; tool versions in `.devcontainer/`    | Backlog 2, 6, 7                                        |
| Committed lockfiles                 | Adopt    | Each subsystem folder                                | Backlog 6, 7                                           |
| Approved package registries         | Adopt    | `webapp/.npmrc`, container settings                  | Backlog 2, 6, 7                                        |
| Dependabot                          | Adopt    | `.github/dependabot.yml`                             | [Backlog 4](../backlog/0004-repository-governance.md)  |
| Ignored files                       | Adopt    | `.gitignore`                                         | This decision                                          |
| Editor conventions                  | Adopt    | `.editorconfig`                                      | This decision                                          |
| Code formatters and linters         | Adopt    | Each subsystem's `tools/check` phase                 | Backlog 6, 7                                           |
| Sanitized environment examples      | Adopt    | `<subsystem>/.env.example`                           | Backlog 6, 7                                           |
| Contributor setup instructions      | Adopt    | Root `README.md`, subsystem READMEs                  | This decision, then each item                          |
| Pull request template               | Adopt    | `.github/pull_request_template.md`                   | [Backlog 4](../backlog/0004-repository-governance.md)  |
| Secret scanning and push protection | Adopt    | GitHub repository settings                           | [Backlog 4](../backlog/0004-repository-governance.md)  |
| Code ownership rules                | Defer    | `.github/CODEOWNERS`                                 | Not planned                                            |
| Dependency review                   | Defer    | `.github/workflows/ci.yml`                           | Not planned                                            |
| Python packages for tooling         | Reject   | Not applicable                                       | Not planned                                            |

#### Validation gate

`tools/check` is the single validation entry point for hosts, the development
container, and CI. It runs every phase without arguments, reports each phase's
result, and exits 0 when all pass, 1 when a phase fails, and 2 on a usage or
prerequisite error. It needs only Bash and Python 3.9 or newer.

The implemented phases are `tools`, which unit-tests the repository tooling,
and `docs`, which checks every Markdown file for frontmatter with a `title` and
`description`, ISO 8601 `ms.date` values, no H1 under a frontmatter title,
working relative links and heading fragments, a `subsystems` list on numbered
ADRs and backlog items, and an index row for each of those documents. It skips
`docs/previous-work/`, reference designs imported from an earlier project
whose links point into that project.

Markdown style lint needs Node.js, which the host does not guarantee. It is
adopted and lands in [backlog 5](../backlog/0005-markdown-style-lint.md) after
the development container provides Node.js.

Each subsystem adds a phase for its formatting, lint, build, and test checks,
in dependency order, with its first deliverable. The service phase runs before
the webapp phase because the webapp's generated client depends on the service
contract. The service phase checks every workspace member, not only the
executable crate.

Selective checks and reusable workflows are rejected for now. With two small
subsystems, a full run is fast and avoids a selector whose mistakes would skip
required checks. Revisit when a full `tools/check` run in CI regularly exceeds
ten minutes or a third subsystem stack is added.

#### Development container

One shared `.devcontainer/` carries every toolchain the gate needs: Bash,
Python 3.9 or newer, rustup, and Node.js with npm. It runs as a non-root user,
pins its base image and feature versions, and documents forwarded ports: the
service uses loopback port 8080, and each later server records a distinct
port in its subsystem README. Credentials stay out of the image and the
repository; contributors supply them at run time. Every command documented for
the container also runs on a host with the same prerequisites.

#### Continuous integration

GitHub Actions runs `tools/check` inside the development container on pull
requests and on pushes to `main`, using the same gate as local development.
The workflow uses `permissions: contents: read` by default, never uses
`pull_request_target` or exposes secrets to pull requests from forks, and pins
every action to a full commit SHA. A final `CI result` job runs with
`if: always()` and fails unless every required job succeeded, so a skipped or
cancelled check never reports success. Branch protection requires only
`CI result`.

#### Versions, lockfiles, and registries

Each subsystem pins its runtime and commits its lockfile in its own folder:
`service/rust-toolchain.toml` with `service/Cargo.lock`, and the Node.js
version in `webapp/package.json` `engines` with `webapp/package-lock.json`.
The development container pins tool versions that match.

npm packages install only through the
`https://packagefeedproxy.microsoft.io/npm/` proxy, configured in an `.npmrc`
beside each `package.json`. Repository tooling that needs npm packages keeps
its manifest in `tools/`, never at the root. Python tooling uses only the
standard library. If a tool later needs a Python package, install it with `uv`
through the `https://packagefeedproxy.microsoft.io/pypi/simple/` proxy and pin
it in a lockfile. [Backlog 6](../backlog/0006-service-foundation.md) confirms
whether Cargo also needs an organizational proxy before it adds a crate
dependency.

Dependabot updates GitHub Actions and the development container first, and each
subsystem adds its ecosystem when its manifest lands. npm entries use the proxy
registry.

#### Review and maintenance

A pull request template asks for the linked backlog item, governing ADRs, and
the `tools/check` result. CODEOWNERS is deferred while one maintainer owns every
path; revisit when a second maintainer joins or a path needs a different
reviewer. The dependency review action is deferred until the first lockfile
lands and the repository's visibility or plan supports it.

#### GitHub repository settings

These settings live in GitHub rather than in version control.
[Backlog 4](../backlog/0004-repository-governance.md) applies them and records
how they were verified.

* Use `main` as the default branch and protect it with a ruleset that requires
  a pull request and the `CI result` status check.
* Set default `GITHUB_TOKEN` permissions to read-only.
* Require approval before workflows run for first-time outside contributors.
* Enable secret scanning, push protection, and Dependabot alerts.

## Alternatives considered

* An `apps/` and `packages/` layout was rejected for now because it adds a
  workspace manager and an empty `packages/` tree with no shared code to hold.
  The revisit triggers above say when to adopt it.
* A root Cargo workspace was rejected for now because only one Rust subsystem
  is planned, and a root manifest would split the service's ownership across
  two folders. A workspace inside `service/` supports internal crates without
  that split.
* A single service crate was rejected because internal crate boundaries make
  responsibilities, public APIs, and dependencies explicit from the start.
* A shared contracts package was rejected because the OpenAPI document under
  `service/` already gives clients one authoritative contract.
* A separate `agent/` subsystem was rejected because the pair-writing agent
  has no deployable or interface of its own; it is service behavior.
* `.github/copilot-instructions.md` was rejected as a duplicate of `AGENTS.md`.
* Selective checks with per-stack reusable workflows were rejected as
  premature for two small subsystems.

## Consequences

* Contributors and agents find every subsystem's rules in its own folder, and
  the root guide stays short.
* Internal crates make service boundaries explicit, at the cost of maintaining
  member manifests and checking the whole workspace.
* The gate validates documentation today. It does not yet lint Markdown style,
  run in CI, or check code, so a green result covers only the phases it lists.
* Subsystem stories must apply the root guide's "Adding a subsystem" checklist,
  including a scoped guide, a `tools/check` phase, a Dependabot entry, and the
  container toolchain.
* Moving to `apps/` and `packages/`, or to a root Cargo workspace, will need a
  new ADR and a mechanical move when its trigger occurs.
* The webapp cannot start real API integration until the service publishes its
  contract.
