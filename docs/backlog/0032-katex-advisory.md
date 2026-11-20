---
title: Resolve the KaTeX advisory in the tools lockfile
description: Clear Dependabot alert 1, a KaTeX advisory that reaches tools/package-lock.json through markdownlint and that a lockfile update alone cannot fix.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - repository
estimated_reading_time: 3
---

## Story

As a maintainer, I want the repository's open security alert resolved so that
the dependency graph carries no known vulnerability and a new alert stands out
when it arrives.

## Context

[Dependabot alert 1](https://github.com/timfpark/writer/security/dependabot/1)
reports [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
(CVE-2026-103923, low severity) in KaTeX, affecting versions from 0.11.0 up to,
but not including, 0.18.2. KaTeX can treat properties inherited from a polluted
`Object.prototype` as renderer options, including `trust`, so rendering
attacker-controlled math into a page without a sanitizer can produce
cross-site scripting.

KaTeX reaches `tools/package-lock.json` as a transitive development
dependency of the Markdown lint that [ADR 0001](../adrs/0001-monorepo-structure.md)
adopts:

```text
markdownlint-cli2 0.24.1
  markdownlint 0.42.1
    micromark-extension-math 3.1.0
      katex 0.16.47
```

`markdownlint-cli2` 0.24.1 is the latest release, `markdownlint` pins
`micromark-extension-math` 3.1.0 exactly, and that package requires
`katex` ^0.16.0, so no update within the declared ranges reaches 0.18.2 and
Dependabot cannot propose one. `markdownlint` imports only the extension's
`math` syntax, never its `mathHtml` renderer. The package index still
re-exports the renderer, so KaTeX loads, but the linter renders nothing and
writes no HTML, so the advisory's conditions do not arise in `tools/check`.

[ADR 0003](../adrs/0003-webapp-architecture.md#typescript) sets the precedent
for a dependency whose declared range lags: an npm `overrides` entry,
recorded as a workaround with a trigger for removing it.

## Scope

* Add an `overrides` entry to `tools/package.json` that pins `katex` to the
  latest release with no known advisory, as an exact version, and regenerate
  `tools/package-lock.json` through the npm proxy with install scripts
  disabled.
* Confirm the override does not change linting: run `markdownlint-cli2` across
  the repository before and after, including on a synthetic file with inline
  and block math syntax, and compare the results.
* Note the override and its removal trigger in [AGENTS.md](../../AGENTS.md),
  as [webapp/AGENTS.md](../../webapp/AGENTS.md) does for its own override:
  remove it once `markdownlint` accepts a KaTeX release outside the advisory's
  range.
* If the override changes linting or breaks `tools/check`, instead dismiss the
  alert in GitHub as vulnerable code that is not used, citing the evidence in
  this story, and record that decision in the pull request.

## Acceptance criteria

* [ ] `npm ls katex` in `tools/` resolves to 0.18.2 or later, or the alert is
  dismissed with the reason recorded.
* [ ] `markdownlint-cli2` reports the same results across the repository as
  before the change.
* [ ] Dependabot alert 1 is closed after the change reaches `main`.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
