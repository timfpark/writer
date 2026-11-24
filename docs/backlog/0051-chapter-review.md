---
title: Review finished chapters
description: When a chapter settles, review it for scene purpose and pacing, character voice, a simulated reader's reaction, and anachronisms, and show the results beside the chapter.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want a fuller review once I have finished a chapter, of its
pacing, its characters' voices, how a first reader might react, and details
wrong for its setting, so that I get an editor's view of the whole chapter
without asking.

## Context

The [background tasks ADR](./0047-background-tasks-ux-adr.md) decides which
of these chapter-level tasks ship, what counts as a chapter settling, and
how the results appear; a reader's reaction may be a living artifact rather
than findings. [Backlog 48](./0048-background-task-evals.md) measures them.
The service's background review from
[backlog 35](./0035-service-background-review.md) and the findings view from
[backlog 36](./0036-background-findings-view.md) provide the plumbing.
Anachronism checks rely on a local model's knowledge, so they need care not
to state wrong facts with confidence.

## Scope

* Detect that a chapter has settled as the background tasks ADR decides, and
  review it once for each shipping task.
* Raise pacing, voice, and anachronism findings anchored to passages, and
  show the reader's reaction as the ADR decides.
* Phrase anachronism findings as questions to check, not corrections.
* Add the prompts and evaluation cases backlog 48 chose, and extend the fake
  provider.

## Acceptance criteria

* [ ] For a synthetic chapter with planted issues, each shipping task
  reports them once the chapter settles, and not before.
* [ ] Editing the chapter again later does not repeat dismissed results for
  unchanged text.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
* [Turn background agents on and off across the workspace tree](./0054-agent-settings-tree.md)
