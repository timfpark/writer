---
title: Configure repository governance on GitHub
description: Add Dependabot and a pull request template, and apply branch protection and secret scanning settings.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 2
---

## Story

As a maintainer, I want dependency updates, review prompts, and branch and
secret protections in place so that `main` only changes through validated,
reviewable pull requests.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#review-and-maintenance) adopts
Dependabot, a pull request template, and the
[GitHub repository settings](../adrs/0001-monorepo-structure.md#github-repository-settings)
it lists. CODEOWNERS and dependency review are deferred.

## Scope

* Add `.github/dependabot.yml` with weekly updates for the `github-actions` and
  `devcontainers` ecosystems.
* Add `.github/pull_request_template.md` asking for the backlog item, governing
  ADRs, and the `tools/check` result.
* Apply the ADR's repository settings: a `main` ruleset requiring a pull
  request and `CI result`, read-only default `GITHUB_TOKEN` permissions,
  approval for first-time contributor workflows, secret scanning, push
  protection, and Dependabot alerts.
* Record in the root `README.md` which settings were applied and how to verify
  them, and update the root `AGENTS.md` repository map.

## Acceptance criteria

* [ ] Dependabot opens or reports no pending updates for both ecosystems
  without configuration errors.
* [ ] A direct push to `main` is rejected, and a pull request cannot merge
  until `CI result` succeeds.
* [ ] Pushing a synthetic test secret pattern is blocked by push protection.
* [ ] New pull requests start from the template.

## Prerequisites

* [Run the validation gate in GitHub Actions](./0003-continuous-integration.md)
