---
title: Writer
description: Monorepo for the Writer service and clients
author: Tim Park
ms.date: 2026-11-20
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

| Subsystem                      | Purpose                                        | Status  |
|--------------------------------|------------------------------------------------|---------|
| [Service](./service/README.md) | Text storage, HTTP API, and the AI pair writer | Active  |
| [Webapp](./webapp/README.md)   | The first client for the system                | Active  |

The service stores the workspace of folders and documents in a data folder
and serves it, with a health endpoint, behind a verified API contract. The
webapp shows that health through a client generated from the contract. Each
guide, for the [service](./service/README.md) and the
[webapp](./webapp/README.md), covers its setup and commands. The repository
also holds its architecture decisions, backlog, validation gate, and
development container.

## Product direction

Writer's first release is a writing application in its own right: a calm
place to organize documents into projects and write them, with storage you
can trust. The AI pair writer builds on that foundation in later releases, so
the first release leaves room for it without depending on it.

### The writing workspace

The webapp is one screen with a header bar above three regions:

| Region                   | Purpose                                                                                                     |
|--------------------------|-------------------------------------------------------------------------------------------------------------|
| Header bar               | Shows and edits the open document's title, toggles the side panes, and holds the user profile on the right  |
| Navigator, left          | A tree of folders and documents, indented by level, for grouping work into projects and subprojects         |
| Writing surface, center  | The open document in a rich-text editor with a carefully chosen typeface on a high-contrast writing surface |
| Assistant, right         | A conversation with the AI pair writer and a box for writing to it, prototyped without an agent at first    |

The writing surface is the focus, and it takes every bit of width the side
panes do not use. Both side panes collapse, so a writer can give the whole
screen to the text. In the navigator, a writer creates documents and folders
at any level, renames, deletes, drags items to move or reorder them, and
collapses whole subtrees to concentrate on one part of a project. The first
release has one local user, so the profile is a placeholder without sign-in.

### Saving and storage

* Changes save automatically in the background. There is no save button; the
  header shows whether the latest change has reached the service.
* Documents are Markdown, edited in a rich-text surface that hides the markup.
* The workspace is mutable: each save replaces a document's current state. A
  later release adds change control in the style of Git, where a writer
  commits a set of changes as one atomic revision and can view or roll back
  to earlier states. The first release's design leaves room for it without
  building it.
* The service stores the workspace on the writer's machine, behind a storage
  interface with interchangeable backends. The first backend uses plain
  files: folders become directories and documents become `.md` files, so the
  workspace stays readable with other tools. SQLite and then PostgreSQL
  backends can follow without changing the API.

The [backlog](./docs/backlog/README.md) orders the decisions and stories that
deliver the workspace, followed by the pair-writing agent.

## Where to look

* [AGENTS.md](./AGENTS.md) holds repository-wide rules for contributors and
  coding agents. [service/AGENTS.md](./service/AGENTS.md) and
  [webapp/AGENTS.md](./webapp/AGENTS.md) hold each subsystem's rules.
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
Git, Python 3.9 or newer, rustup with a default Rust toolchain, Node.js
with npm, and the GitHub CLI. Each version is recorded once: the
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

Cargo downloads crates from crates.io directly. The organization requires no
registry proxy for Cargo, so the image configures none.

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

The container forwards port 8888, where the service listens, and port 5180,
where the webapp's development server listens, so a browser or request on the
host reaches either one running in the container when you use VS Code. The
Dev Container CLI does not forward ports; use `devcontainer exec` to make
requests inside the container instead. The container holds no credentials;
supply any secret at run time rather than in the image, the repository, or
build arguments.

#### GitHub CLI

The container also carries the [GitHub CLI](https://cli.github.com/), `gh`,
installed from GitHub's signed package repository, so you or a coding agent
can open pull requests and watch their checks as [AGENTS.md](./AGENTS.md)
describes. It reads its credential from `GH_TOKEN`, which the container copies
from the environment that starts it. Every process in the container can read
that token, including package install scripts and build scripts, so give it
only what pull requests need:

1. On GitHub, open **Settings**, **Developer settings**, **Personal access
   tokens**, **Fine-grained tokens**, and choose **Generate new token**.
2. Set a short expiration, such as 30 days, and under **Repository access**
   choose **Only select repositories** and pick `timfpark/writer`.
3. Under **Repository permissions**, grant read and write on **Contents** and
   **Pull requests**, and read-only on **Actions** and **Commit statuses**.
   Leave every other permission at no access. Without **Workflows**, the
   token cannot push changes to `.github/workflows/`, and without
   **Administration**, it cannot change the ruleset that protects `main`.
4. Export the token on the host, then start VS Code or the Dev Container CLI
   from that shell, so the container receives it:

   ```bash
   export GH_TOKEN=<fine-grained token>
   code .
   ```

5. If the container was already running, run **Dev Containers: Rebuild
   Container** or **Dev Containers: Reopen in Container**, then check access
   inside it with `gh auth status`.

In VS Code, `git push` inside the container keeps using the Git credentials
that VS Code forwards from the host, so the token's limits apply to `gh` and
its API calls rather than to those pushes. With the Dev Container CLI, which
forwards no credentials, run `gh auth setup-git` once in the container so Git
pushes with the token.

Keep the token in a password manager or your shell's secret store, never in a
file in the repository. When `GH_TOKEN` is unset, `gh` is unauthenticated and
CI is unaffected. Revoke the token on GitHub when you no longer need it. The
ruleset on `main` still requires a pull request and a passing `CI result`, so
the token cannot push to `main`, but it can merge a pull request whose checks
pass; the repository's agent guide leaves merging to the maintainer.

### Host setup

On a host, `tools/check` needs Git, Bash, Python 3.9 or newer, Node.js 26.13.1
with npm, and [rustup](https://rustup.rs/) with `cargo` on `PATH`. Node.js
must be exactly the version `webapp/package.json` pins in `engines`, the same
version the container carries, for example installed with
`nvm install 26.13.1`; `tools/check` exits 2 on any other. In `service/`,
rustup installs the Rust version that `service/rust-toolchain.toml` pins, with
`clippy` and `rustfmt`, the first time Cargo runs. Configure pip or uv to use
the registry proxies above. The `.npmrc` files in `tools/` and `webapp/`
already set the npm proxy for their folders, and Cargo needs no proxy.

The [service guide](./service/README.md) and the
[webapp guide](./webapp/README.md) cover running and configuring each
subsystem.

### Continuous integration

The [CI workflow](./.github/workflows/ci.yml) builds the development container
and runs `tools/check` inside it on every pull request and every push to
`main`. On pull requests, a dependency review job also fails when a change to
a lockfile or other manifest adds a dependency with a known vulnerability, in
any scope and at any severity. A newer push to a pull request cancels that
pull request's running checks. The final `CI result` check passes only when
every CI job succeeds, so a failed, skipped, or cancelled job never reports
success. The one exception is dependency review on a push to `main`, where
the job does not run. The workflow uses a read-only token, no repository
secrets, and actions pinned to full commit SHAs.

Dependency review depends on GitHub's dependency graph, which the repository
gets for free while it stays public. Making it private would disable the
check unless GitHub Advanced Security is enabled.

## Repository governance

`main` changes only through pull requests that pass CI. Two files in
`.github/` and a set of GitHub settings enforce this, as
[ADR 0001](./docs/adrs/0001-monorepo-structure.md#github-repository-settings)
decides.

* [dependabot.yml](./.github/dependabot.yml) opens weekly update pull requests
  for GitHub Actions, the development container features, the container's
  digest-pinned base image, the npm tooling manifest in `tools/`, the
  service's Cargo workspace, and the webapp's npm manifest. Each subsystem adds its ecosystem when its
  manifest lands, and npm entries use the registry proxy.
* The [pull request template](./.github/pull_request_template.md) asks for the
  backlog item, the governing ADRs, and the `tools/check` result. GitHub
  inserts it verbatim, so it is the one Markdown file without frontmatter.

### Repository settings

These settings live in GitHub, not in version control. They were applied on
2026-11-19 and verified as the table describes. Any repository administrator
can confirm them with the GitHub CLI.

| Setting                                                           | `gh api` path under `repos/timfpark/writer`        | Verified by                                    |
|-------------------------------------------------------------------|----------------------------------------------------|------------------------------------------------|
| Ruleset `main` requires a pull request and `CI result`, no bypass | `rules/branches/main`                              | A direct push to `main` was rejected           |
| Default `GITHUB_TOKEN` permissions are read-only                  | `actions/permissions/workflow`                     | `default_workflow_permissions` is `read`       |
| First-time contributors' workflows need approval                  | `actions/permissions/fork-pr-contributor-approval` | `approval_policy` is `first_time_contributors` |
| Secret scanning and push protection                               | The repository root, field `security_and_analysis` | A synthetic Azure Storage key push was blocked |
| Dependabot alerts                                                 | `vulnerability-alerts`                             | The endpoint returns HTTP 204                  |

The ruleset requires no approving review, because one maintainer owns every
path, and GitHub's default of one extra approval for unattributed Copilot pull
requests stays on. To check push protection again, push a commit with a
synthetic Azure Storage connection string to a scratch branch and confirm the
push is rejected. A synthetic `ghp_` token was not blocked in testing, so it
is not a reliable probe.
