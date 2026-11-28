---
title: Measure the remaining background agents
description: Add cases, first prompts, and scoring for the ten background agents that ship after the first five, and measure whether the leading local models can do each before backlog 49 to 53 build them.
author: Tim Park
ms.date: 2026-11-28
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want each background agent that ships after the first
five measured on local models before it is built so that only agents a
writer's machine can do well reach backlog 49 to 53.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) picks the fifteen Wave 1
shipping agents, their shapes, triggers, structural quietness gates, and
ranked order. [Backlog 48](./0048-background-agent-evals.md) measures the
five pause-triggered agents that
[backlog 35](./0035-service-background-review.md) ships first. This story
measures the other ten, which the later delivery stories build:

* `Story notes`, `Continuity check`, and `Timeline` in
  [backlog 49](./0049-story-notes-continuity.md)
* `Open threads` and `Reverse outline` in
  [backlog 50](./0050-threads-and-outline.md)
* `Scene purpose and pacing`, `Character voice`, and `Reader reaction` in
  [backlog 51](./0051-chapter-review.md)
* `Session recap` in [backlog 52](./0052-session-recap.md)
* `The writer's own rules` in [backlog 53](./0053-writer-rules.md)

[ADR 0010](../adrs/0010-pair-writing-models.md) measured only suggestions,
questions, and disconnects.
[Backlog 56](./0056-story-notes-continuity-test.md) tests the story notes
and continuity chain and adds scoring for living artifacts against expected
content, and backlog 48 adds synthetic technical nonfiction for scoring
false alarms. This story builds on both. It runs beside backlog 35 and
backlog 36, off the path to the first agents.

This story measures feasibility with a first prompt per agent. Each
delivery story, backlog 49 to 53, tunes its own agents' prompts on these
cases when it builds them, so prompts are tuned against the models and
experience current at the time.

## Scope

* For each of the ten agents, write synthetic cases with expected results:
  planted issues for findings, and expected entries for artifacts, such as
  the scenes and goals a reverse outline should list. Include coherent cases
  that should produce no finding, and holdout cases.
* For `Story notes` and `Continuity check`, start from backlog 56's cases,
  scoring, and prompts rather than writing new ones.
* Since every agent runs on every document at first, run each agent on
  backlog 48's synthetic technical nonfiction, and score its false alarms
  there.
* Write a first prompt for each agent, and for agents that use another's
  output, chain them in the harness as backlog 56 does.
* Measure each agent on ADR 0010's chosen model and its closest challengers,
  with the automatic scores and the judge.
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

* [ ] Each of the ten agents has committed cases, a first prompt, and a
  result summary on at least two models, with holdout scores reported
  separately.
* [ ] Each of the ten agents has a false-alarm score on synthetic technical
  nonfiction.
* [ ] The ADRs record which agents are feasible, on which model, at what
  cost, and which are deferred.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Measure the first background agents](./0048-background-agent-evals.md)
