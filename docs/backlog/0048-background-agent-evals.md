---
title: Measure the first background agents
description: Add cases, first prompts, and scoring for the five pause-triggered background agents that backlog 35 ships first, and measure whether the leading local models can do each before backlog 35 builds them.
author: Tim Park
ms.date: 2026-11-28
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want the five background agents that ship first
measured on local models before they are built so that only agents a
writer's machine can do well reach the first delivery story, without
waiting on agents that ship later.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) picks the fifteen Wave 1
shipping agents (deferring anachronisms and the five nonfiction agents),
their shapes, triggers, structural quietness gates, and ranked order. Its
five highest-ranked agents run on a short typing pause over a paragraph or
scene: `Weak prose`, `Clarity`, `Open questions`, `Point of view and
tense`, and `Repetition`. [Backlog 35](./0035-service-background-review.md)
ships them, and [backlog 36](./0036-background-findings-view.md) shows
their findings in Writer.
[ADR 0010](../adrs/0010-pair-writing-models.md) measured only suggestions,
questions, and disconnects. [Backlog 56](./0056-story-notes-continuity-test.md)
tests the story notes and continuity chain, and this story builds on its
harness and scoring where they apply.

This story measures only those five, so the first agents do not wait on
the ten that ship later. [Backlog 63](./0063-remaining-background-agent-evals.md)
measures the rest ahead of backlog 49 to 53. Backlog 35 tunes these five
agents' prompts on this story's cases when it builds them, so prompts are
tuned against the models and experience current at the time.

## Scope

* For each of the five agents, write synthetic cases with planted issues,
  coherent cases that should produce no finding, and holdout cases.
* Since every agent runs on every document at first, write synthetic
  technical nonfiction, run each of the five agents on it, and score its
  false alarms. Keep these documents reusable so backlog 63 scores the
  remaining agents on them.
* Write a first prompt for each agent.
* Measure each agent on ADR 0010's chosen review model and its closest
  challengers, with the automatic scores and the judge.
* Where [backlog 45](./0045-cloud-model-proxy.md)'s proxy runs, add one
  frontier cloud model as a ceiling, so an agent that fails everywhere is
  told apart from one only local models fail.
* Measure each agent's time and energy over a changed paragraph and its
  scene, and state whether it fits the background agents ADR's short-pause
  trigger.
* Amend the background agents ADR or ADR 0010 with which of the five agents
  are feasible, on which model, and which are deferred for quality or cost.
* Commit the cases, prompts, and result summaries, and quote only synthetic
  text.

## Acceptance criteria

* [ ] Each of the five agents has committed cases, a first prompt, and a
  result summary on at least two models, with holdout scores reported
  separately.
* [ ] Each of the five agents has a false-alarm score on synthetic
  technical nonfiction.
* [ ] The ADRs record which of the five agents are feasible, on which
  model, at what cost, and which are deferred.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Test story notes for continuity checking](./0056-story-notes-continuity-test.md)
