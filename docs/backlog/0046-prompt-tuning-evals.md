---
title: Tune the conversation prompt with the evaluation harness
description: Let harness configurations name their prompts, sweep conversation prompt variants across the leading local models, score them on tuning cases and report holdout cases, and choose the prompt the pair writer starts from.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As a writer, I want the pair writer's conversation prompt chosen from
measured alternatives rather than written once so that its answers are as
useful as the models allow from the first time I use it.

## Context

[ADR 0010](../adrs/0010-pair-writing-models.md) measured every model with
one conversation prompt and one review prompt, written once and never tuned.
Part of the difference between models may be how well each suits those
prompts.

The `evals/` harness records each prompt's digest in every result summary and
splits cases into `tune` and `holdout`, so prompt work can be measured
without overstating it. Its configurations choose a model and its settings,
but not yet a prompt.

Conversation is the first mode writers use, through
[backlog 12](./0012-first-pair-writing-agent.md) and
[backlog 34](./0034-assistant-pane-agent.md), so its prompt is tuned first.
Background agents' prompts are tuned by their delivery stories, starting
with [backlog 35](./0035-service-background-review.md), on the cases
[backlog 48](./0048-background-agent-evals.md) writes, using the prompt
selection this story adds.

## Scope

* Let a configuration name its prompt for each task, and record the prompt's
  name and digest in each result summary. Keep the current prompts as the
  baseline.
* Add conversation tuning cases so the sweep does not fit a handful of
  requests: more passages and requests, including the three example
  requests from the [experience ADR](./0038-pair-writing-experience-adr.md)
  story. Leave the holdout cases unseen until the final run, and add new
  holdout cases written without looking at any variant's output.
* Write conversation prompt variants and give the reason for each, at least
  limits on length and format, instructions to quote exactly and respect the
  writer's voice, and worked examples of a good answer.
* Sweep the variants across ADR 0010's chosen conversation model and its
  closest challengers, at least two, since the best prompt may differ by
  model and may change the model choice.
* Rank variants on tuning cases with the automatic scores and the judge, and
  stop variants that do not beat the baseline. Run the finalists once on the
  holdout cases, and have the maintainer score a blind sheet of finalists
  only.
* Measure each variant's time to the first token and tokens per reply.
* Document in `evals/README.md` how to sweep prompt variants, so the
  delivery stories tune their agents the same way.
* Amend ADR 0010 with the chosen conversation prompt, its holdout results,
  and any change to the chosen model.
* Commit the chosen prompt and the result summaries, and quote only
  synthetic text.

## Acceptance criteria

* [ ] Result summaries for the baseline and every finalist are committed,
  each naming its prompt and digest, with holdout scores reported separately
  from tuning scores.
* [ ] The maintainer's blind scores of the finalists are ingested.
* [ ] ADR 0010 names the conversation prompt and states whether it changed
  the model choice.
* [ ] `evals/README.md` describes how to sweep prompt variants.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
