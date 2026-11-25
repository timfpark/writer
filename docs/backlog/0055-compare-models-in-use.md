---
title: Compare models while writing
description: Let the writer switch the model behind each mode, run opt-in side-by-side trials of a candidate model in real use, and record which findings they act on, so the model choice evolves as local models improve.
author: Tim Park
ms.date: 2026-11-24
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

The [model ADR](./0039-pair-writing-model-adr.md) chose the first models
from synthetic cases, a judge model, and a small blind sheet. It is the
first decision, not the last: open-weight models improve about every six
months, and the `evals/` harness reruns the same cases on each new release
to screen candidates. Synthetic cases cannot show how a model serves a
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

* Let the writer choose the model for conversation and for background
  review in settings, from the models Ollama has pulled, without a code
  change, and show each model's measured memory and speed from the harness
  where known.
* Add an opt-in trial of a candidate model: for a share of conversation
  replies or reviews the writer sets, also run the candidate, show the two
  results side by side without model names, and record which the writer
  prefers. Keep trials short, and show their cost in time and battery.
* Record, per model and digest, which findings the writer acts on and which
  they dismiss, and how often they keep, edit, or discard a conversation
  reply's suggestion, storing only counts and choices, never text.
* Show a summary per model: trial preferences, act and dismiss rates, and
  speed, and let the writer adopt the candidate from it.
* Let the maintainer export the summary, with no text, as a result summary
  the harness's `report` command can read beside its synthetic runs, so a
  model decision can cite real use.
* Document the cycle in `evals/README.md`: screen each new model release on
  the harness's cases, trial the leaders in real use, then amend the model
  ADR.
* Add service, webapp, and browser tests with the fake provider, and test
  that no text is stored with a preference or count.

## Acceptance criteria

* [ ] Switching the conversation or review model in settings takes effect
  without restarting the service.
* [ ] A trial shows two blind results side by side, records the writer's
  choice, and stops when its share or period ends.
* [ ] The per-model summary shows trial preferences and act and dismiss
  rates, and an exported summary contains no document or message text.
* [ ] `evals/README.md` describes how new models are screened and trialed.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
