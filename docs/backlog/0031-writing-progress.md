---
title: Show writing progress over time
description: Compute words and characters added and removed per document and folder across commits, and show writers how their work grew over time.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to see how much I wrote, revised, and cut in each
document and folder over days and weeks so that I can track my progress and
understand where my effort went.

## Context

The [change control ADR](./0027-change-control-adr.md) defines the progress
measures, how Markdown markup is counted, and whether measures are stored per
commit or computed from diffs. Because history follows items by identifier,
measures stay attached to a document across rename and move.
[Backlog 29](./0029-service-history.md) provides the commits the measures
come from, and [backlog 30](./0030-history-view.md) the history view that
links to them. [ADR 0004](../adrs/0004-api-conventions.md) keeps manuscript
text out of logs and error details, which applies to the diffs behind every
measure.

## Scope

* Compute the ADR's measures between consecutive commits for every document
  and folder, and add an endpoint that returns them over a range of commits
  or days.
* Regenerate `service/openapi.json` and the webapp's API client.
* Show progress over time for the workspace, a folder, and a document, with
  a keyboard-operable, accessible presentation.
* Test the measures against a synthetic history with known counts, including
  a renamed, moved, and deleted document.

## Acceptance criteria

* [ ] For a synthetic history with known edits, the service and webapp
  report exactly the expected words added and removed per document and day.
* [ ] A document's progress continues across its rename and move.
* [ ] No title or content appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record and restore commits in the service](./0029-service-history.md)
* [Browse, compare, and restore history in the webapp](./0030-history-view.md)
