---
title: Check the writer's own rules
description: Let writers state their own style rules, and have background review flag text that breaks them.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer with my own style, I want to tell the pair writer my rules, such
as avoiding adverbs in dialogue tags or spelling a place name one way, and
have it flag text that breaks them, so that its review follows my style
rather than a generic one.

## Context

The [background agents ADR](./0047-background-agents-ux-adr.md) decides how
rules are written and how their findings appear. Rules apply to the whole
workspace at first; scoping them to folders and documents comes with
[backlog 54](./0054-agent-settings-tree.md), and
[backlog 48](./0048-background-agent-evals.md) measures how reliably local
models follow them. Background review from
[backlog 35](./0035-service-background-review.md) runs the checks, and
[backlog 36](./0036-background-findings-view.md) shows the findings.

## Scope

* Store the writer's rules as the background agents ADR decides, and expose
  them through the API under [ADR 0004](../adrs/0004-api-conventions.md).
* Add a keyboard-operable, accessible place to write, edit, and remove
  rules.
* Check text against the rules on the ADR's trigger, and raise findings that
  name the rule and the passage.
* Add the prompt and evaluation cases backlog 48 chose.

## Acceptance criteria

* [ ] A rule added in the webapp produces a finding on a synthetic passage
  that breaks it, and none on one that keeps it.
* [ ] Removing the rule stops its findings.
* [ ] No rule or document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
