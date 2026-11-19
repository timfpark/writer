---
title: Decide the monorepo foundation
description: Record ADR 0001 for Writer's repository structure, agent discoverability, and development tooling baseline.
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 5
---

## Story

As a contributor or coding agent, I want one documented monorepo structure
and development workflow so that I can find the right code, understand its
boundaries, and validate changes without guessing or relying on chat history.

Writer is a constant pair writer: it asks questions, suggests other ideas,
and checks prose for quality and consistency. The repository must support
that product while treating the agents developing it as first-class
consumers of its documentation and tooling.

## Context

The [project README](../../README.md) identifies a planned service and web
client. The scaffold contains a [root agent guide](../../AGENTS.md),
an [ADR index](../adrs/README.md), this [backlog](./README.md), and an empty
[validation entry point](../../tools/check).

The agent guide describes a Rust service, a TypeScript/React client,
tooling, and decisions that are not implemented or recorded here. It also
contains inherited portfolio-specific guidance. Treat those claims as
inputs to review, not evidence that the infrastructure exists or that the
architecture has been accepted.

## Scope

Record the first ADR as `docs/adrs/0001-monorepo-structure.md`. Use the first
record number in the ADR index, replacing its example entry; story and ADR
numbering remain independent.

The deliverable is an architectural decision, aligned repository guidance,
and prioritized implementation stories. Do not build the application,
container, or CI workflows as part of this story.

### Repository structure and boundaries

* Compare top-level subsystem folders with an `apps/` and `packages/`
  layout. Choose the simplest structure justified by the current service
  and web client, and describe when it should change.
* Define responsibilities and allowed dependency directions between the
  service, clients, and any shared code. Decide where API contracts and
  generated clients belong, and which artifacts are authoritative.
* Confirm or revise the scaffold's proposed stack, workspace, manifest,
  lockfile, and toolchain ownership only as needed for this layout.
  Leave product architecture decisions to later ADRs.
* Assign locations for tests, synthetic fixtures, future AI evaluation
  cases, configuration examples, developer scripts, and documentation.
  Distinguish source, generated output, and local-only data.
* Keep ADRs and backlog stories indexed under `docs/`. Create subsystem
  folders only with their first deliverable; do not add empty placeholders
  or speculative CLI, shared-library, or agent subsystems.

### Agent discoverability

* Define a short navigation path from the root `README.md` and `AGENTS.md`
  to subsystem responsibilities, governing ADRs, backlog priorities, and
  validation commands.
* Keep repository-wide rules in the root guide and subsystem-specific
  rules in scoped guides. Define how an agent discovers the applicable
  instructions, including any needed GitHub Copilot entry point, without
  duplicating independently maintained rules.
* Give each subsystem guide a purpose, dependency boundaries, governing
  decisions, and exact setup, run, and check commands once implemented.
  Label future commands and paths as planned rather than runnable.
* Distinguish coding-agent guidance from the product's pair-writing agent
  behavior. Identify where future prompts, model integrations, and
  evaluations should live without choosing an agent framework now.
* Document safe handling of credentials, manuscript content, generated
  artifacts, and synthetic test data. Prefer non-interactive commands with
  explicit prerequisites, useful diagnostics, and meaningful exit codes.

### Development and automation baseline

Assess each area below. Record an adopt, defer, or reject decision with
its rationale, intended location, and implementation dependency. Adopt
only tooling justified by the initial development workflow.

* A shared `.devcontainer/` with reproducible toolchains, non-root
  development, documented ports, and host/container command parity.
  Keep credentials out of the image and repository.
* GitHub Actions for pull requests and the default branch, using the same
  checks as local development. Address least-privilege permissions,
  untrusted pull requests, pinned actions, and a required result that does
  not report success when required checks fail or are skipped.
* A working `tools/check` contract covering applicable formatting, lint,
  build, and test checks, plus Markdown, frontmatter, and relative-link
  validation. Decide whether selective checks or reusable workflows are
  warranted now rather than inheriting that complexity.
* Runtime and dependency version pinning, committed lockfiles, approved
  package registries, and dependency updates such as Dependabot.
* `.gitignore`, editor and formatting conventions, sanitized environment
  examples, and contributor setup instructions.
* Review and maintenance support such as ownership rules, pull request
  templates, dependency review, and secret scanning. Record any GitHub
  repository settings separately from version-controlled configuration.

## Acceptance criteria

* [ ] ADR 0001 records context, decision status and date, alternatives,
  rationale, consequences, and `subsystems` metadata. It includes a
  repository tree distinguishing existing paths from planned paths,
  subsystem boundaries, and a tooling decision for every area above.
* [ ] The ADR index replaces its example with the real record. The root
  README and agent guide agree with the ADR, distinguish planned from
  implemented capabilities, and remove inherited portfolio assumptions
  and references to nonexistent decisions or guides.
* [ ] A contributor or agent starting with only the root README or agent
  guide can locate the ADR, backlog, subsystem responsibilities, and
  validation entry point through working relative links. Any unavailable
  checks or setup steps are explicitly identified as pending work.
* [ ] Each adopted but unimplemented capability has a scoped, prioritized
  backlog story with an observable completion condition and explicit
  prerequisites. Deferred capabilities have a reason and a revisit
  trigger; no selected tooling is implied to exist already.
* [ ] The implementation backlog orders the validation foundation,
  reproducible development environment, and CI according to their actual
  dependencies. No empty subsystem folders or application features are
  added to satisfy this decision story.
* [ ] Review verifies the documented tree and links against the actual
  scaffold and walks the agent navigation path without relying on prior
  conversation. Run `tools/check` and report any blocker explicitly;
  the current empty file is not evidence that validation passed.

## Prerequisites

None.
