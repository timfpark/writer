---
title: Compare models while writing
description: Run opt-in side-by-side trials of a candidate model in real use, and record which findings and replies the writer acts on per model, so the model choice evolves as local models improve.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 3
---

## Story

As a writer, I want to try a new model on my own work, compare its answers
and findings with the current model's, and switch when it is better, so that
the pair writer keeps up as local models improve.

## Context

The [model ADR](../adrs/0010-pair-writing-models.md) chose the first models
from synthetic cases, a judge model, and a small blind sheet. It is the
first decision, not the last: open-weight models improve about every six
months, and the `evals/` harness reruns the same cases on each new release
to screen candidates. [Backlog 57](./0057-model-settings.md) lets the writer
switch models by hand. Synthetic cases cannot show how a model serves a
writer's own work over weeks, and the maintainer's blind scores found that
writers may value coverage more than the judge does.

Real use gives two kinds of evidence the harness cannot:

* Explicit: a writer choosing between two blind answers to the same request.
* Implicit: which findings a writer acts on or dismisses, per model.

The [agent ADR](./0010-agent-architecture-adr.md) decides how models are
configured and how conversations and findings are recorded, and the
[conversations ADR](./0037-agent-conversations-adr.md) decides what is
stored. Manuscript text never leaves the machine, and nothing here commits
or sends it.

## Scope

* Add an opt-in trial of a candidate model from those backlog 57 lists: for
  a share of conversation replies or reviews the writer sets, also run the
  candidate, show the two results side by side without model names, and
  record which the writer prefers. Keep trials short, refuse a trial whose
  two models do not fit in memory together, and show its cost in time and
  battery.
* Record, per model and digest, which findings the writer acts on and which
  they dismiss, and how often they keep, edit, or discard a conversation
  reply's suggestion, storing only counts and choices, never text.
* Show a summary per model: trial preferences, act and dismiss rates, and
  speed, and let the writer adopt the candidate from it through backlog 57's
  settings.
* Let the maintainer export the summary, with no text, as a result summary
  the harness's `report` command can read beside its synthetic runs, so a
  model decision can cite real use.
* Document the cycle in `evals/README.md`: screen each new model release on
  the harness's cases, trial the leaders in real use, then amend the model
  ADR.
* Add service, webapp, and browser tests with the fake provider, and test
  that no text is stored with a preference or count.

## Acceptance criteria

* [ ] A trial shows two blind results side by side, records the writer's
  choice, and stops when its share or period ends.
* [ ] The per-model summary shows trial preferences and act and dismiss
  rates, and an exported summary contains no document or message text.
* [ ] `evals/README.md` describes how new models are screened and trialed.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Choose the model for each mode in settings](./0057-model-settings.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
