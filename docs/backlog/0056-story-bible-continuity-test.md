---
title: Test a story bible for continuity checking
description: Measure whether extracting a story bible chapter by chapter, then checking continuity against it, finds the disconnects that whole-manuscript review missed on local models, and at what cost, before the agent architecture is chosen.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want to know whether chaining a story bible into a
continuity check closes the disconnect gap on local models so that the agent
architecture is chosen knowing whether agents must chain their outputs and
keep living artifacts.

## Context

[ADR 0010](../adrs/0010-pair-writing-models.md) found that no local model
reliably finds contradictions within a chapter or across chapters when it
reads the text at once. [ADR 0011](../adrs/0011-background-agents-ux.md)
ships a story bible, a living artifact extracted chapter by chapter, and
chains a continuity check onto it rather than rereading the manuscript.

Whether that works shapes the
[agent architecture ADR](./0010-agent-architecture-adr.md): chained agents,
stored intermediate results, and incremental updates per chapter are
different machinery from one review per request. This story answers that
one question early and leaves measuring every other agent to
[backlog 48](./0048-background-agent-evals.md).

## Scope

* Write synthetic manuscripts of several chapters with planted
  contradictions in names, ages, appearance, places, objects, and timing,
  within a chapter and across chapters, and coherent manuscripts that should
  produce none. Keep holdout cases.
* Add scoring for an extracted story bible: recall and precision of expected
  entries, and whether each entry cites a passage that supports it.
* Write a first extraction prompt and a first continuity prompt, and chain
  them in the harness: extract chapter by chapter, merge the entries, then
  check each chapter against the merged bible.
* Compare the chain with ADR 0010's whole-manuscript review on the chosen
  review model and its closest challenger, for contradictions found, false
  alarms, time, tokens, and energy.
* Measure an incremental update: the cost of re-extracting one changed
  chapter and rechecking it, against rebuilding the bible.
* Where [backlog 45](./0045-cloud-model-proxy.md)'s proxy runs, add one
  frontier cloud model as a ceiling, so a failure can be told apart from a
  task the approach cannot do.
* Amend ADR 0010 with the result, and state what it requires of the agent
  architecture.
* Commit the cases, prompts, and result summaries, and quote only synthetic
  text.

## Acceptance criteria

* [ ] Result summaries compare the chain with whole-manuscript review on at
  least two local models, with holdout scores reported separately.
* [ ] ADR 0010 records whether the chain closes the disconnect gap, at what
  cost, and what it requires of the agent architecture.
* [ ] `tools/check` exits 0 without Ollama, a model, credentials, or network
  access to model providers.

## Prerequisites

None.
