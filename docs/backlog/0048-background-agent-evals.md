---
title: Measure the background agents with the evaluation harness
description: Add cases, first prompts, and scoring for each background agent the background agents ADR ships, and measure whether the leading local models can do each before its delivery story builds it.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want each background agent the pair writer will run
measured on local models before it is built so that only agents a writer's
machine can do well reach the backlog's delivery stories.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) picks the fifteen Wave 1
shipping agents (deferring anachronisms and the five nonfiction agents),
their shapes, triggers, structural quietness gates, and ranked order.
[ADR 0010](../adrs/0010-pair-writing-models.md) measured only suggestions,
questions, and disconnects. [Backlog 56](./0056-story-notes-continuity-test.md)
tests the story notes and continuity chain, and this story builds on its
cases, scoring, and prompts. The `evals/` harness scores findings against
planted issues; living artifacts, such as story notes or a timeline, need
scoring against expected content, which backlog 56 adds.

This story measures feasibility with a first prompt per agent. Each
delivery story, [backlog 35](./0035-service-background-review.md) and
backlog 49 to 53, tunes its own agents' prompts on these cases when it
builds them, so prompts are tuned against the models and experience current
at the time.

## Scope

* For each shipping agent, write synthetic cases with expected results:
  planted issues for findings, and expected entries for artifacts, such as
  the scenes and goals a reverse outline should list. Include coherent cases
  that should produce no finding, and holdout cases.
* Since every agent runs on every document at first, run each agent on
  synthetic technical nonfiction, and score its false alarms there.
* Write a first prompt for each agent, and for agents that use another's
  output, chain them in the harness as backlog 56 does.
* Measure each agent on ADR 0010's chosen model and its closest challengers,
  with the automatic scores and the judge, and have the maintainer score a
  blind sheet for the agents where they disagree.
* Where [backlog 45](./0045-cloud-model-proxy.md)'s proxy runs, add one
  frontier cloud model as a ceiling, so an agent that fails everywhere is
  told apart from one only local models fail.
* Measure each agent's time and energy at its trigger's scope, and state
  whether it fits the background agents ADR's trigger.
* Amend the background agents ADR or ADR 0010 with which agents are
  feasible, on which model, and which are deferred for quality or cost.
* Commit the cases, prompts, and result summaries, and quote only synthetic
  text.

## Acceptance criteria

* [ ] Every shipping agent has committed cases, a first prompt, and a result
  summary on at least two models.
* [ ] The ADRs record which agents are feasible, on which model, at what cost,
  and which are deferred.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Test story notes for continuity checking](./0056-story-notes-continuity-test.md)
