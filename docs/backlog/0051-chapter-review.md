---
title: Review finished chapters
description: When a chapter settles, review it for scene purpose and pacing, character voice, and a simulated reader's reaction using the story bible and reverse outline, and show the results beside the chapter.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 2
---

## Story

As a writer, I want a fuller review once I have finished a chapter, of its
pacing, its characters' voices, and how a first reader might react, so that
I get an editor's view of the whole chapter without asking.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) ships three chapter-settled
review agents here (`Scene purpose and pacing`, `Character voice`, and
`Reader reaction`), defines what counts as a chapter settling, makes
`Reader reaction` a collapsible chapter card inside the `Findings` tab
rather than inline underlines, and defers anachronisms and facts until
after per-book settings ([backlog 54](./0054-agent-settings-tree.md)) and
stronger factual grounding. To stay within
[ADR 0010](../adrs/0010-pair-writing-models.md)'s cost bounds and avoid
noise, `Character voice` reads the story bible from
[backlog 49](./0049-story-bible-continuity.md) and `Scene purpose and
pacing` reads the reverse outline from
[backlog 50](./0050-threads-and-outline.md).
[Backlog 48](./0048-background-agent-evals.md) measures them, and
[backlog 35](./0035-service-background-review.md) and
[backlog 36](./0036-background-findings-view.md) provide the review
plumbing and findings view.

## Scope

* Detect that a chapter has settled as ADR 0011 defines (leaving the
  document, extended idle after substantive edits on AC, or ending a
  session, above the chapter minimum word count), and review it once for
  each shipping agent.
* Raise `Scene purpose and pacing` findings (reading the reverse outline)
  and `Character voice` findings (reading the story bible, skipped on
  chapters without dialogue) anchored to passages through backlog 36's
  view.
* Generate `Reader reaction` (engagement, confusion, predictions) as a
  chapter-level living artifact shown in a collapsible card inside the
  `Findings` tab, with no inline underlines on the writing surface.
* Tune each agent's prompt on backlog 48's cases, as backlog 35 tunes its
  agents, and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with
  the chosen prompts. Add the prompts and cases, and extend the fake
  provider.

## Acceptance criteria

* [ ] For a synthetic chapter with planted pacing and voice issues, each
  agent reports them and shows the collapsible reader reaction once the
  chapter settles, and not before.
* [ ] Editing the chapter again later does not repeat dismissed results for
  unchanged text.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Keep a story bible and check continuity](./0049-story-bible-continuity.md)
* [Track open threads and keep a reverse outline](./0050-threads-and-outline.md)
