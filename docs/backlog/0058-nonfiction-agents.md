---
title: Check technical nonfiction
description: Measure and build the nonfiction background agents the first wave deferred, for terminology, concept order, code examples, technical accuracy, and cross-references, run only where the workspace tree turns them on.
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

As a writer of a technical book, I want the pair writer to check that my
terms stay consistent, concepts come before they are used, code examples
match the text, and references point where they say, so that my readers are
not tripped up by errors I could not see.

## Context

The [background agents ADR](./0047-background-agents-ux-adr.md) defers the
nonfiction agents so the first wave serves fiction, and records what they
need from it. [Backlog 54](./0054-agent-settings-tree.md) lets writers turn
agents on for a folder or document, so these agents run on a technical book
and never on a novel, without each having to recognize fiction and stay
quiet. Background review from
[backlog 35](./0035-service-background-review.md), its findings view from
[backlog 36](./0036-background-findings-view.md), and the living artifacts
from [backlog 49](./0049-story-bible-continuity.md), which a terminology
list can reuse, provide the plumbing. Technical accuracy relies on a local
model's knowledge, so it needs care not to state wrong facts with
confidence.

## Scope

* Amend the background agents ADR with the shape, scope, trigger, surface,
  and interruption of each nonfiction agent that ships, and defer or cut the
  rest with reasons.
* Write synthetic technical nonfiction cases with planted issues and
  coherent cases that should produce none, add a first prompt for each
  agent, measure them on ADR 0010's models as
  [backlog 48](./0048-background-agent-evals.md) does, and tune the prompts
  of those that are feasible as backlog 35 does.
* Build each feasible agent on the background review plumbing, with
  findings anchored to passages and any terminology list kept as a living
  artifact the writer can correct.
* Phrase technical accuracy findings as questions to check, not
  corrections.
* Offer the nonfiction agents as a preset, if backlog 54's decision includes
  presets.
* Extend the fake provider, and add service, webapp, and browser tests.

## Acceptance criteria

* [ ] The background agents ADR records which nonfiction agents ship and
  why, with committed result summaries for each on at least two models.
* [ ] For a synthetic technical chapter with planted issues, each shipping
  agent reports them, and none runs on a document where it is off.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Turn background agents on and off across the workspace tree](./0054-agent-settings-tree.md)
