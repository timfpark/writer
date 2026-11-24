---
title: Tune the pair-writing prompts with the evaluation harness
description: Sweep prompt variants for conversation and for each background agent the background agents ADR ships across the leading local models, score them on tuning cases and report holdout cases, and choose the prompts the pair writer starts from.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - evals
  - service
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer's prompts chosen from measured
alternatives rather than written once so that its answers and findings are as
useful as the models allow, and so that a kind of finding is not deferred for
a weakness a better prompt would fix.

## Context

The [model ADR](./0039-pair-writing-model-adr.md) measured every model with
one conversation prompt and one review prompt, written once and never tuned.
Part of the difference between models may be how well each suits those
prompts. The review prompt asks for suggestions, questions, and disconnects
in one pass, capped at eight findings, and disconnects across a chapter or a
manuscript were the gap no model closed.

The `evals/` harness records each prompt's digest in every result summary and
splits cases into `tune` and `holdout`, so prompt work can be measured
without overstating it. Its configurations choose a model and its settings,
but not yet a prompt.

The [background agents ADR](./0047-background-agents-ux-adr.md) decides which
background agents ship, and [backlog 48](./0048-background-agent-evals.md)
writes a first prompt for each and measures whether local models can do it.
This story tunes those prompts as well as the conversation prompt and the
original review prompt.

The [experience ADR](./0038-pair-writing-experience-adr.md) decides which
kinds of finding ship from these results, and
[backlog 12](./0012-first-pair-writing-agent.md) and
[backlog 35](./0035-service-background-review.md) start the service's
prompts from the prompts this story chooses.

## Scope

* Let a configuration name its prompt for each task, and record the prompt's
  name and digest in each result summary. Keep the current prompts as the
  baseline.
* Add tuning cases so the sweep does not fit eleven cases: more scenes and
  chapters with planted issues of each kind, and more coherent documents
  that should produce none. Leave the holdout cases unseen until the final
  run, and add new holdout cases written without looking at any variant's
  output.
* Write prompt variants for conversation and for each agent backlog 48
  found feasible, and give the reason for each, at least:
  * Separate passes per kind of finding instead of one combined pass
  * A disconnect pass that first lists facts such as names, ages, dates,
    places, and objects, then compares them across passages and documents
  * Worked examples of a good finding and a false alarm
  * Different caps on the number of findings, and wording that asks for
    fewer, stronger findings
  * Brief reasoning before a disconnect pass, on models that offer it
  * For conversation, limits on length and format, and instructions to quote
    exactly and respect the writer's voice
* Sweep the variants across the model ADR's chosen model and its closest
  challengers, at least two, since the best prompt may differ by model and
  may change the model choice.
* Rank variants on tuning cases with the automatic scores and the judge, and
  stop variants that do not beat the baseline. Run the finalists once on the
  holdout cases, and have the maintainer score a blind sheet of finalists
  only.
* Measure the cost of each variant: time and tokens per review, since
  separate passes multiply calls.
* Amend the model ADR with the chosen prompts, their holdout results, and any
  change to the chosen model, and record whether disconnects remain a gap.
* Commit the chosen prompts and the result summaries, and quote only
  synthetic text.

## Acceptance criteria

* [ ] Result summaries for the baseline and every finalist are committed,
  each naming its prompt and digest, with holdout scores reported separately
  from tuning scores.
* [ ] The maintainer's blind scores of the finalists are ingested.
* [ ] The model ADR names the prompt for conversation and for each kind of
  finding, states whether it changed the model choice, and records any kind
  of finding still not good enough.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
* [Measure the background agents with the evaluation harness](./0048-background-agent-evals.md)
