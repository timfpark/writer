---
title: "ADR 0001: Monorepo structure, agent navigation, and tooling baseline"
description: Repository layout, subsystem boundaries, agent discoverability, and the development and automation baseline for Writer
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - repository
  - service
  - webapp
  - evals
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

Amended on 2026-11-20 by [ADR 0009](./0009-browser-tests.md), which places
the browser tests in `webapp/e2e/`, adds the `browser` phase to the
validation gate, and adds the Playwright browsers to the development
container.

Amended on 2026-11-22 by [ADR 0010](./0010-pair-writing-models.md), which
adds the `evals/` subsystem: the harness, synthetic cases, and committed run
summaries that score models and prompts. Evaluations move there from the
planned `service/evals/`, and the validation gate gains an `evals` phase.

## Decision summary

* Organize the monorepo around self-contained top-level subsystem folders,
  `service/` (Rust Cargo workspace), `webapp/` (TypeScript and React), and
  `evals/` (standard-library Python evaluation harness), created with their
  first deliverable rather than as empty placeholders.
* Couple clients to `service/` only through its HTTP API and committed OpenAPI
  contract under `service/`, with generated client code in
  `webapp/src/api/generated/` verified for freshness.
* Keep coding-agent guidance (`AGENTS.md` and `.github/`) strictly separate
  from product pair-writing prompts (`service/prompts/`) and evaluations
  (`evals/`).
* Never commit credentials, `.env` files, or real manuscripts; use sanitized
  `*.example` files, synthetic prose, and the ignored `.local/` directory.
* Pin toolchains in `.devcontainer/` alongside subsystem version pins and
  lockfiles, and install npm or Python packages only through the organization
  registry proxies.
* Validate every change locally and in CI with `tools/check` from the
  repository root (`0` pass, `1` check failure, `2` usage or prerequisite
  error).

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
`evals/`, which [ADR 0010](./0010-pair-writing-models.md) added, is a
developer subsystem: it ships nothing to writers and is not deployable, so it
does not count toward the `apps/` and `packages/` triggers below.

The tree below shows the target repository layout. Paths that do not exist yet
arrive with the backlog story that first needs them; check the filesystem and
the [backlog](../backlog/README.md) rather than treating this tree as a live
status board.

```text
writer/
  .editorconfig                editor formatting conventions
  .gitignore                   build output, secrets, local-only data
  .markdownlint-cli2.jsonc     Markdown style lint rules
  AGENTS.md                    root coding-agent guide
  README.md                    project overview for people
  docs/
    adrs/                      decision records, indexed by README.md
    backlog/                   prioritized work, indexed by README.md
  tools/
    check                      validation gate
    check_docs.py              docs phase of the gate
    package.json, .npmrc       pins markdownlint-cli2 via npm proxy
    package-lock.json          locked Markdown lint dependencies
    tests/                     unit tests for repository tooling
  .devcontainer/               shared development container
  .github/
    workflows/ci.yml           runs tools/check in the container
    dependabot.yml             weekly dependency updates
    pull_request_template.md   pull request checklist
  service/
    AGENTS.md, README.md
    Cargo.toml, Cargo.lock, rust-toolchain.toml
    crates/                    internal Cargo workspace members
    openapi.json               API contract of record
    prompts/                   pair-writing agent prompts
    .env.example
  webapp/
    AGENTS.md, README.md
    package.json, package-lock.json, .npmrc
    src/api/generated/         client generated from the service contract
    .env.example
  evals/
    AGENTS.md, README.md
    writer_evals/              standard-library Python harness
    cases/                     synthetic cases and the documents they read
    prompts/                   candidate and judge prompts
    results/                   committed run summaries
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

| Subsystem | Responsibility                                                                                             | Stack                   | May depend on                                                            |
|-----------|------------------------------------------------------------------------------------------------------------|-------------------------|--------------------------------------------------------------------------|
| `service` | Text storage, business rules, the HTTP API, and the pair-writing agent (prompts, model calls, evaluations) | Rust, Cargo             | Its own crates and external services                                     |
| `webapp`  | The first client: editing, presenting pair-writer suggestions, and calling the service                     | TypeScript, React, npm  | The service only through its HTTP API contract                           |
| `evals`   | Scores models and prompts against synthetic cases and commits run summaries; ships nothing to writers      | Python standard library | Model runtimes such as Ollama, and the service only through its HTTP API |

Dependencies point from clients to the service. The service never imports
client code, and clients never import service source, read its storage, or
call model providers directly. `evals/` calls model runtimes directly to
compare them, and reaches the service's pair writer only through its HTTP
API; it never imports service or webapp source.

The checked-in OpenAPI document under `service/` is the API contract of
record. A later service ADR decides whether it is written by hand or emitted
from service code; either way, the service's checks must fail when the
document and the implementation disagree. The webapp's API client is generated
from that document into `webapp/src/api/generated/`, committed, and checked
for freshness. Generated files are never edited by hand.

### Artifact locations

| Artifact                          | Location                                                                 | Kind                       |
|-----------------------------------|--------------------------------------------------------------------------|----------------------------|
| Unit and integration tests        | Inside each subsystem, following its stack's convention                  | Source                     |
| Synthetic test fixtures           | Inside each subsystem, next to the tests that use them                   | Source                     |
| AI evaluation harness and cases   | `evals/`                                                                 | Source, synthetic only     |
| AI evaluation run summaries       | `evals/results/`                                                         | Committed, no model output |
| Raw model output from evaluations | `.local/evals/raw/`                                                      | Local only, ignored        |
| Agent prompts                     | `service/prompts/`                                                       | Source                     |
| Configuration examples            | `<subsystem>/.env.example` or another `*.example` file                   | Source, sanitized          |
| Repository-wide developer scripts | `tools/`                                                                 | Source                     |
| Subsystem scripts                 | The stack's own runner, such as Cargo commands or `package.json` scripts | Source                     |
| Repository-wide documentation     | `docs/`, with ADRs and backlog items indexed by their README files       | Source                     |
| Subsystem documentation           | `<subsystem>/README.md` for people, `<subsystem>/AGENTS.md` for agents   | Source                     |
| API contract                      | `service/openapi.*`                                                      | Committed, verified        |
| Generated API client              | `webapp/src/api/generated/`                                              | Generated, committed       |
| Build output and dependencies     | `target/`, `node_modules/`, `dist/`, `coverage/`                         | Generated, ignored         |
| Real secrets and local settings   | `.env`, `.env.*` except examples                                         | Local only, ignored        |
| Local manuscripts and scratch     | `.local/`                                                                | Local only, ignored        |

Cross-subsystem end-to-end tests are deferred until both subsystems exist and
a story needs them; that story chooses their location.
[ADR 0009](./0009-browser-tests.md) places the browser tests, which drive the
webapp against a running service, in `webapp/e2e/`.

### Agent discoverability

Agents and people follow one navigation path:

1. The root `README.md` gives the product overview and links to `AGENTS.md`,
   this ADR, the backlog, and the validation gate.
2. The root `AGENTS.md` holds concise repository-wide rules: the subsystem
   table, key shared paths, safety invariants, authoring conventions, and
   validation. It links each subsystem guide once that guide exists.
3. Each `<subsystem>/AGENTS.md` holds that subsystem's purpose, dependency
   boundaries, distilled operational rules, a Governing decisions section
   linking the ADRs that govern it (consulted when changing architecture,
   dependencies, or conventions), and exact setup, run, and check commands.
4. The [ADR index](./README.md) and [backlog index](../backlog/README.md)
   list every decision and every item of planned work, with their governed
   subsystems verified against frontmatter by `tools/check`.

GitHub Copilot, including the coding agent, reads `AGENTS.md` files natively,
and nested guides apply to their folders. A separate
`.github/copilot-instructions.md` would duplicate independently maintained
rules, so it is rejected. Revisit if a tool in use stops reading `AGENTS.md`;
the fix then is a one-line pointer to `AGENTS.md`, not a copy of it.

Commands and paths that do not exist yet are written in code spans and labeled
planned, never as links. `tools/check` fails on broken relative links, which
keeps that rule enforced.

### Adding a subsystem

Create a subsystem folder with its first deliverable, never as an empty
placeholder, and make these changes in the same pull request:

1. Add a `README.md` for people and an `AGENTS.md` guide with the subsystem's
   purpose, dependency boundaries, active operational rules, a Governing
   decisions section linking every ADR whose `subsystems` frontmatter names it,
   exact setup, run, and check commands, and the rule that toolchain,
   dependency, or environment changes update `.devcontainer/`, version pins,
   and setup documentation in the same change.
2. Update the subsystem status and guide link in the root
   [AGENTS.md](../../AGENTS.md) and [README.md](../../README.md).
3. Keep the subsystem's manifest, lockfile, toolchain pin, and `.env.example`
   inside its folder. For an npm project, add an `.npmrc` with the proxy.
4. Add its validation phase to [tools/check](../../tools/check) in dependency
   order, with `service` before `webapp`.
5. Ensure its toolchain in `.devcontainer/` matches the version the subsystem
   pins, and add its ecosystem to
   [dependabot.yml](../../.github/dependabot.yml) (using the proxy `registries`
   entry for npm).
6. Bind any local server to loopback (`127.0.0.1:8888` for `service`, and a
   distinct port such as `127.0.0.1:5180` for `webapp`), record it in the
   subsystem README, and add it to the devcontainer's `forwardPorts`.

### Coding agents and the product agent

`AGENTS.md` files, and anything under `.github/`, guide the coding agents that
develop Writer. The pair-writing agent is product behavior. Its prompts live in
`service/prompts/` and its model integrations in service code. Its evaluation
cases, the harness that runs them, and their results live in `evals/`. Product prompts are never placed in coding-agent
guidance, and coding-agent guidance never becomes product prompts. Choosing an
agent framework or model provider is deferred to a later service ADR.

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

| Area                                | Decision | Location                                             |
|-------------------------------------|----------|------------------------------------------------------|
| Validation gate, docs phase         | Adopt    | `tools/check`, `tools/check_docs.py`                 |
| Markdown style lint                 | Adopt    | `.markdownlint-cli2.jsonc`, `tools/check` docs phase |
| Development container               | Adopt    | `.devcontainer/`                                     |
| GitHub Actions CI                   | Adopt    | `.github/workflows/ci.yml`                           |
| Selective checks                    | Reject   | Not applicable                                       |
| Reusable workflows                  | Reject   | Not applicable                                       |
| Runtime and toolchain pinning       | Adopt    | Each subsystem; tool versions in `.devcontainer/`    |
| Committed lockfiles                 | Adopt    | Each subsystem folder and `tools/`                   |
| Approved package registries         | Adopt    | `tools/.npmrc`, `webapp/.npmrc`, container settings  |
| Dependabot                          | Adopt    | `.github/dependabot.yml`                             |
| Ignored files                       | Adopt    | `.gitignore`                                         |
| Editor conventions                  | Adopt    | `.editorconfig`                                      |
| Code formatters and linters         | Adopt    | Each subsystem's `tools/check` phase                 |
| Sanitized environment examples      | Adopt    | `<subsystem>/.env.example`                           |
| Contributor setup instructions      | Adopt    | Root `README.md`, subsystem READMEs                  |
| Pull request template               | Adopt    | `.github/pull_request_template.md`                   |
| Secret scanning and push protection | Adopt    | GitHub repository settings                           |
| Code ownership rules                | Defer    | `.github/CODEOWNERS`                                 |
| Dependency review                   | Adopt    | `.github/workflows/ci.yml`                           |
| Python packages for tooling         | Reject   | Not applicable                                       |

#### Validation gate

`tools/check` is the single validation entry point for hosts, the development
container, and CI. It runs every phase without arguments, reports each phase's
result, and exits 0 when all pass, 1 when a phase fails, and 2 on a usage or
prerequisite error. It requires Bash, Python 3.9 or newer, npm with exactly the
Node.js version `webapp/package.json` pins in `engines`, and Cargo installed
with rustup.

The implemented phases are `tools`, which unit-tests the repository tooling,
and `docs`, which checks every Markdown file for frontmatter with a `title` and
`description`, ISO 8601 `ms.date` values, no H1 under a frontmatter title,
working relative links and heading fragments, a `subsystems` list on numbered
ADRs and backlog items, an index row for each of those documents, and Markdown
style rules via a pinned `markdownlint-cli2` package in `tools/`. The `service`
phase, added by the service foundation (backlog 6), checks formatting, lints
with warnings denied, builds, and tests every Cargo workspace member, including
the contract freshness test. The `webapp` phase, added by the webapp
foundation (backlog 7), installs the locked dependencies, checks the generated
client's freshness, formatting, lint, and types, runs the tests, and builds,
as [ADR 0003](./0003-webapp-architecture.md#quality-checks) lists. The
`browser` phase, added by backlog 21, runs the browser and accessibility tests
after it, and exits 2 when a browser cannot launch, as
[ADR 0009](./0009-browser-tests.md#gate) decides. The gate exits 1 when any
phase fails, and otherwise 2 when any phase lacks a prerequisite.
The `evals` phase, added by [ADR 0010](./0010-pair-writing-models.md), runs
after `service` and unit-tests the evaluation harness against a fake runtime,
so it needs no model runtime, model, or network access.

Markdown style lint landed in backlog 5 after the development container
provided Node.js.

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
Python 3.9 or newer, rustup, Node.js with npm, and the Playwright browsers. It runs as a non-root user,
pins its base image and feature versions, and documents forwarded ports: the
service uses loopback port 8888, and each later server records a distinct
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

On pull requests, a dependency review job runs GitHub's dependency review
action and fails when a dependency change in any scope, including development
dependencies, adds a known vulnerability of any severity. It compares the
dependency graph through the GitHub API, which stays available while the
repository is public; a private repository would need GitHub Advanced
Security. Pushes to `main` skip the job, and `CI result` accepts that skip
only outside pull requests.

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
it in a lockfile. The service foundation confirmed that the organization
requires no registry proxy for Cargo, so Cargo downloads crates from crates.io
directly.

Dependabot updates GitHub Actions and the development container first, and each
subsystem adds its ecosystem when its manifest lands. npm entries use the proxy
registry.

#### Review and maintenance

A pull request template asks for the linked backlog item, governing ADRs, and
the `tools/check` result. CODEOWNERS is deferred while one maintainer owns every
path; revisit when a second maintainer joins or a path needs a different
reviewer. Backlog 14 adopted the dependency review action, described under
[Continuous integration](#continuous-integration), once `tools/package-lock.json`
landed and the public repository's dependency graph supported it.

#### GitHub repository settings

These settings live in GitHub rather than in version control. Backlog 4
applied them, and the
[root README](../../README.md#repository-settings) records how to verify
them.

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
* Evaluations in `service/evals/`, this record's original plan, were replaced
  by the top-level `evals/` subsystem in
  [ADR 0010](./0010-pair-writing-models.md), because the same harness and
  cases compare models and runtimes the service never ships, and must reach
  the pair writer wherever the agent architecture places it.
* `.github/copilot-instructions.md` was rejected as a duplicate of `AGENTS.md`.
* Selective checks with per-stack reusable workflows were rejected as
  premature for two small subsystems.

## Consequences

* Contributors and agents find every subsystem's rules in its own folder, and
  the root guide stays short.
* Internal crates make service boundaries explicit, at the cost of maintaining
  member manifests and checking the whole workspace.
* The gate validates documentation, Markdown style, the service, and the
  webapp locally and in CI. A green result covers only the phases it lists, so
  each later subsystem must add its own.
* Subsystem stories must apply the [Adding a subsystem](#adding-a-subsystem)
  checklist above, including a scoped guide, a `tools/check` phase, a
  Dependabot entry, and the container toolchain.
* Moving to `apps/` and `packages/`, or to a root Cargo workspace, will need a
  new ADR and a mechanical move when its trigger occurs.
* The webapp cannot start real API integration until the service publishes its
  contract.
