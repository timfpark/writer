---
title: Measure the background tasks with the evaluation harness
description: Add cases, prompts, and scoring for each background task the background tasks ADR ships, measure whether the leading local models can do each, and test whether a story bible makes continuity checking work.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want each background task the pair writer will run
measured on local models before it is built so that only tasks a writer's
machine can do well reach the backlog's delivery stories.

## Context

The [background tasks ADR](./0047-background-tasks-ux-adr.md) decides which
tasks ship, their shapes, triggers, and order. The
[model ADR](./0039-pair-writing-model-adr.md) measured only suggestions,
questions, and disconnects, and found disconnects across a manuscript beyond
the local models when they read the whole text at once. The `evals/` harness
scores findings against planted issues; living artifacts, such as a story
bible or a timeline, need scoring against expected content instead.

## Scope

* For each shipping task, write synthetic cases with expected results, in
  fiction and in technical nonfiction for the tasks that apply to each:
  planted issues for findings, and expected entries for artifacts, such as
  the characters, ages, and places a story bible should list. Include
  coherent cases that should produce no finding, and holdout cases.
* Add scoring for artifacts: recall and precision of expected entries, and
  whether each entry cites a passage that supports it.
* Write a first prompt for each task, and for tasks that use another's
  output, such as continuity checks reading the story bible, chain them in
  the harness.
* Test whether extracting a story bible chapter by chapter, then checking
  continuity against it, finds the disconnects that whole-manuscript review
  missed, at what cost in time and tokens.
* Measure each task on the model ADR's chosen model and its closest
  challengers, with the automatic scores and the judge, and have the
  maintainer score a blind sheet for the tasks where they disagree.
* Measure each task's time and energy at its trigger's scope, and state
  whether it fits the background tasks ADR's trigger.
* Amend the background tasks ADR or the model ADR with which tasks are
  feasible, on which model, and which are deferred for quality or cost.
* Commit the cases, prompts, and result summaries, and quote only synthetic
  text.

## Acceptance criteria

* [ ] Every shipping task has committed cases and a result summary on at
  least two models.
* [ ] The ADRs record which tasks are feasible, on which model, at what cost,
  and which are deferred.
* [ ] The story bible approach to continuity is measured against
  whole-manuscript review.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the background tasks UX ADR](./0047-background-tasks-ux-adr.md)
