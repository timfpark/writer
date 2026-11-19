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
  build output.
* Run the lint from the docs phase of `tools/check` using the locked version,
  installing with `npm ci` when needed. Exit 2 with a clear message when
  Node.js is missing.
* Fix existing violations and add the npm ecosystem to Dependabot.

## Acceptance criteria

* [ ] Adding trailing whitespace or a misaligned table to a Markdown file makes
  `tools/check` exit 1 with the file and line.
* [ ] `tools/check` exits 0 inside the development container on the final
  contents of the change.
* [ ] Running `tools/check` without Node.js exits 2 and names the missing
  prerequisite.

## Prerequisites

* [Add a reproducible development container](./0002-development-container.md)
* [Configure repository governance on GitHub](./0004-repository-governance.md),
  which creates the Dependabot configuration
