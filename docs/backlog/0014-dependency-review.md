---
title: Add dependency review to pull request CI
description: Run GitHub's dependency review action on pull requests now that the repository has a committed lockfile and public visibility supports the dependency graph.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 2
---

## Story

As a maintainer, I want pull requests that add or update dependencies checked
for known vulnerabilities before merge so that risky versions are caught in CI
alongside `tools/check`.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#review-and-maintenance) deferred
GitHub's dependency review action until the first lockfile landed and the
repository's visibility or plan supported it. Backlog 5 committed
`tools/package-lock.json` and confirmed that `timfpark/writer` is public, with
the dependency graph compare endpoint (`dependency-graph/compare`) enabled and
returning results. Dependency review stays available on the current personal
plan as long as the repository remains public; making the repository private
without GitHub Advanced Security would disable that endpoint.

## Scope

* Add a dependency review job to
  [ci.yml](../../.github/workflows/ci.yml) that runs
  `actions/dependency-review-action` on `pull_request` events, pinned to a full
  commit SHA with a version comment.
* Keep `permissions: contents: read`, use no secrets, and never trigger on
  `pull_request_target`.
* Wire the job into `CI result` so a failed or cancelled dependency review
  fails `CI result` on pull requests while `push` runs on `main` (where
  dependency review does not run) still report `CI result` accurately.
* Update [ADR 0001](../adrs/0001-monorepo-structure.md) and
  [README.md](../../README.md) to reflect the active check.

## Acceptance criteria

* [ ] A pull request that adds a lockfile entry with a known vulnerability
  fails the dependency review job and `CI result`.
* [ ] A clean pull request and a push to `main` both pass `CI result`.
* [ ] Every action in `.github/workflows/ci.yml` is pinned to a full commit SHA
  and runs with `permissions: contents: read`.
* [ ] `tools/check` exits 0.

## Prerequisites

None. `tools/package-lock.json` and the [CI workflow](../../.github/workflows/ci.yml)
already exist.
