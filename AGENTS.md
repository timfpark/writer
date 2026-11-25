---
title: Writer Agent Guide
description: Repository-wide rules, navigation, and validation for contributors and coding agents working on Writer
---

## Overview and navigation

Writer is a local-first writing workspace and AI pair writer (see
[README.md](./README.md)). `service/` and `webapp/` exist; start with the
[backlog index](./docs/backlog/README.md) for prioritized work and the
[ADR index](./docs/adrs/README.md) for governing decisions, beginning with
[ADR 0001](./docs/adrs/0001-monorepo-structure.md).

1. Before changing a subsystem, read its `AGENTS.md` for local rules and
   commands.
2. Read the `Subsystems` and `Summary` columns in
   [docs/adrs/README.md](./docs/adrs/README.md) and each governing ADR's top
   `Decision summary` first; read full ADR bodies only when changing
   architecture, dependencies, or conventions.
3. Follow the [Adding a subsystem](./docs/adrs/0001-monorepo-structure.md#adding-a-subsystem)
   checklist when creating any new subsystem.

| Subsystem  | Responsibility                                               | Stack                   | Guide                                    | Status |
|------------|--------------------------------------------------------------|-------------------------|------------------------------------------|--------|
| `service/` | Workspace storage, domain rules, `/api/v1/` API, pair writer | Rust, Cargo             | [service/AGENTS.md](./service/AGENTS.md) | Active |
| `webapp/`  | React editing workspace consuming the generated API client   | TypeScript, React, npm  | [webapp/AGENTS.md](./webapp/AGENTS.md)   | Active |
| `evals/`   | Scores models and prompts on synthetic cases; ships nothing  | Python standard library | [evals/AGENTS.md](./evals/AGENTS.md)     | Active |

* Couple clients to `service/` only through its HTTP API and committed
  [service/openapi.json](./service/openapi.json) contract; never import across
  subsystems. Only `service/` and `evals/` call model runtimes.
* Keep coding-agent files (`AGENTS.md` and `.github/`) separate from product
  pair-writer prompts (`service/prompts/`, planned) and evaluations
  ([evals/](./evals/)). Commit evaluation run summaries, never raw model
  output, which stays in `.local/evals/raw/`.
* Target [tools/check](./tools/check), [tools/check_docs.py](./tools/check_docs.py),
  and `tools/tests/` directly when inspecting repository tooling; avoid broad
  globs under `tools/` because `tools/node_modules/` holds installed lint
  packages. Skip `service/target/`, which holds Cargo build output, and
  `webapp/node_modules/`, `webapp/dist/`, and `webapp/test-results/`, which
  hold installed packages, build output, and browser test traces.
* Treat [.devcontainer/](./.devcontainer/) as the canonical source of pinned
  toolchain versions and global registry proxies, and keep local scratch or
  manuscripts inside ignored `.local/`.

## Safety and repository invariants

* Never commit credentials, tokens, or `.env` files; document settings with
  placeholders in sanitized `*.example` files.
* Never commit real manuscripts or paste them into code, fixtures, evaluations,
  logs, issues, or pull requests; use synthetic prose, names, and identifiers.
* Regenerate generated files ([service/openapi.json](./service/openapi.json)
  and [webapp/src/api/generated/](./webapp/src/api/generated/)) with their
  generators rather than editing them by hand, and regenerate the webapp
  client in the same change as the contract.
* Do not create empty placeholder folders; write non-existent paths and
  commands in code spans labeled planned, never as Markdown links.
* Add dependencies only when needed, and update [.devcontainer/](./.devcontainer/),
  matching version pins (`rust-toolchain.toml`, `package.json` `engines`), and
  setup docs in [README.md](./README.md) and subsystem guides in the same
  change.
* Install npm packages only via `https://packagefeedproxy.microsoft.io/npm/`,
  configured in an `.npmrc` beside each `package.json`. Keep Python tooling on
  the standard library only (or `uv` via
  `https://packagefeedproxy.microsoft.io/pypi/simple/` if ever required).
  Cargo uses crates.io directly; no registry proxy is required.
* Keep the `overrides` entry in [tools/package.json](./tools/package.json)
  that pins `katex`, which `markdownlint` reaches through
  `micromark-extension-math`, to a release outside advisory
  GHSA-238p-pmpm-9mq7; remove it once `markdownlint` accepts KaTeX 0.18.2 or
  later.
* Record consequential architectural choices in `docs/adrs/` and maintain the
  ADR and backlog indexes as [docs/adrs/README.md](./docs/adrs/README.md) and
  [docs/backlog/README.md](./docs/backlog/README.md) specify.

## Authoring, CI, and Git conventions

* Format every Markdown file except
  [pull_request_template.md](./.github/pull_request_template.md) with YAML
  frontmatter (`title` and `description`, plus `subsystems` matching the index
  `Subsystems` column on numbered `NNNN-*.md` files). Start body headings at
  `##` (never `#`), use `*` for unordered lists and emphasis, align table
  pipes, avoid em dashes and bolded-prefix list items, and use relative links.
* Write repository scripts to run non-interactively, verify prerequisites, name
  the failing file or setting, and exit nonzero on error (`2` for usage or
  missing prerequisites).
* In [ci.yml](./.github/workflows/ci.yml), pin actions to full commit SHAs with
  version comments, keep `permissions: contents: read`, never use
  `pull_request_target` or repository secrets, and add every new job to
  `CI result`'s `needs` list.
* Work on a branch for a pull request to `main` using conventional commits
  (`feat`, `fix`, `docs`, `ci`, `build`, `refactor`, `test`, `chore`),
  optionally scoped to `service`, `webapp`, `evals`, `devcontainer`, or `tools`, with an
  imperative subject such as
  `feat(webapp): add webapp foundation with generated API client`.

## Validation

* Use fast targeted commands while iterating: `python3 tools/check_docs.py`,
  `python3 -m unittest discover --start-directory tools/tests`, or the affected
  subsystem's test runner, such as `cargo test --workspace` in `service/`,
  `npm run test` and `npm run e2e` in `webapp/`, or
  `python3 -m unittest discover --start-directory tests --top-level-directory .`
  in `evals/`.
* Before every commit and before reporting work complete, run `tools/check`
  with no arguments from the repository root on the final contents of the
  change, and rerun it after any edit. If `tools/check` fails or cannot run,
  report the blocker and do not commit or claim validation passed.

## Delivering a backlog item

When a backlog item (story or ADR) meets its acceptance criteria and
`tools/check` passes on the final contents, deliver it without waiting to be
asked:

1. Retire the item as [docs/backlog/README.md](./docs/backlog/README.md)
   specifies, in the same change.
2. Commit to a branch, never to `main`: create one from the latest `main`,
   such as `feat/0007-webapp-foundation`, and make one conventional commit
   whose subject summarizes the item.
3. Push the branch and open a pull request to `main` with
   `gh pr create --base main`, titled with the commit subject, which becomes
   the squash commit. Fill every section of the
   [pull request template](./.github/pull_request_template.md), including
   the last lines of `tools/check` and where it ran.
4. Monitor it with `gh pr checks <number> --watch` until `CI result`
   finishes; if it reports no checks because CI has not registered yet, wait
   briefly and rerun it. On a failure, read the log with
   `gh run view <run-id> --log-failed`,
   fix the cause, rerun `tools/check`, push a new commit rather than
   rewriting history, and watch again. Address review comments the same way.
5. Report the pull request URL and its final check status. Leave merging to
   the maintainer unless asked, and never bypass branch protection.

In the development container, `gh` authenticates with the `GH_TOKEN` the
maintainer supplies from the host, as the
[README](./README.md#github-cli) describes. Never print, log, store, or
replace that token, and never run `gh auth login` or `gh auth logout`. If `gh`
is missing or not authenticated, or a push is rejected, commit locally,
report the blocker, and stop.
