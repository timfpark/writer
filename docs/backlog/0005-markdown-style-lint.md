---
title: Add Markdown style lint to the validation gate
description: Enforce the repository's Markdown style with a pinned markdownlint-cli2 run from the docs phase of tools/check.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want Markdown style problems reported by
`tools/check` so that headings, lists, tables, and spacing stay consistent
without relying on editor extensions.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#validation-gate) adopts Markdown
style lint but defers it until Node.js is available. The docs phase already
checks frontmatter, links, and index coverage.

## Scope

* Add `tools/package.json` and `tools/package-lock.json` that pin
  `markdownlint-cli2`, and a `tools/.npmrc` that sets the
  `https://packagefeedproxy.microsoft.io/npm/` proxy. Keep the manifest out of
  the root so it does not suggest a JavaScript workspace.
* Add `.markdownlint-cli2.jsonc` with rules matching the existing
  documentation, including aligned tables and `*` list markers, and ignoring
  build output. The pull request template has no frontmatter and starts at an
  H2 heading because GitHub copies it into pull request bodies, so exempt it
  from the first-line heading rule.
* Run the lint from the docs phase of `tools/check` using the locked version,
  installing with `npm ci` when needed. Exit 2 with a clear message when
  Node.js is missing.
* Fix existing violations.
* Add a Dependabot npm entry for `tools/` that uses the
  `https://packagefeedproxy.microsoft.io/npm/` proxy registry, as
  [ADR 0001](../adrs/0001-monorepo-structure.md#versions-lockfiles-and-registries)
  requires.
* `tools/package-lock.json` is the repository's first lockfile, which meets
  one of ADR 0001's conditions for revisiting the deferred dependency review
  action. Check whether the repository's visibility or plan supports it,
  record the result in the pull request, and add a backlog item to adopt it
  if supported.

## Acceptance criteria

* [ ] Adding trailing whitespace or a misaligned table to a Markdown file makes
  `tools/check` exit 1 with the file and line.
* [ ] `tools/check` exits 0 inside the development container on the final
  contents of the change.
* [ ] Running `tools/check` without Node.js exits 2 and names the missing
  prerequisite.

## Prerequisites

None. The [Dependabot configuration](../../.github/dependabot.yml) that the
npm entry extends already exists.
