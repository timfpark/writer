---
title: Run the validation gate in GitHub Actions
description: Run tools/check inside the development container on every pull request and push to main, behind one required result.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 2
---

## Story

As a maintainer, I want every pull request and push to `main` to run the same
`tools/check` gate used locally so that a change cannot merge with failing or
skipped checks.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#continuous-integration) adopts
GitHub Actions running `tools/check` inside the development container, with a
`CI result` job as the only required check. Selective checks and reusable
workflows are rejected for now.

## Scope

* Create the GitHub repository if it does not exist and push `main`.
* Add `.github/workflows/ci.yml`, triggered by `pull_request` and by `push` to
  `main`, never by `pull_request_target`.
* Set workflow `permissions: contents: read` and grant nothing broader per job.
* Pin every action to a full commit SHA with a version comment.
* Run `tools/check` inside the development container, for example with the
  `devcontainers/ci` action.
* Add a `CI result` job with `if: always()` that fails unless every needed job
  reports `success`.
* Cancel superseded runs for the same pull request.
* Update the root `AGENTS.md` repository map from planned to existing.

## Acceptance criteria

* [ ] A pull request that breaks a relative link fails `CI result`.
* [ ] A pull request with a passing gate reports `CI result` as successful.
* [ ] A run where the check job is skipped or cancelled reports `CI result` as
  failed.
* [ ] Every `uses:` line references a 40-character commit SHA.
* [ ] No workflow references `pull_request_target` or repository secrets.

## Prerequisites

* [Add a reproducible development container](./0002-development-container.md)
