---
title: Review documents in the background in the service
description: Add background review that runs the first paragraph- and scene-level background agents on a document, with prompts tuned on their evaluation cases, and returns findings anchored to the passages they concern.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - evals
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer to read my text while I work and come
back with findings I did not think to ask for, such as weak prose, slips in
point of view, unclear passages, and questions that open other directions,
so that I get help without stopping to ask.

## Context

The [background agents ADR](./0047-background-agents-ux-adr.md) decides which
paragraph- and scene-level agents ship first, such as weak prose,
repetition, point of view and tense, clarity, and open questions, with their
triggers, surfaces, and interruption, and whether the writer can pause
them. The [experience ADR](./0038-pair-writing-experience-adr.md) sets the
targets for memory and battery. The [agent
ADR](./0010-agent-architecture-adr.md) decides how findings anchor to
passages, how reviews start, skip unchanged text, and stay within those
targets, and how findings reach the webapp. The [conversations
ADR](./0037-agent-conversations-adr.md) decides whether each review is stored
as a conversation of its own and how it points to the version of the text it
read. [Backlog 12](./0012-first-pair-writing-agent.md) builds the agent crate,
`service/prompts/`, the conversation cases in `evals/`, and the fake provider
this story extends. [Backlog 48](./0048-background-agent-evals.md) wrote
cases and a first prompt for each agent and measured which are feasible, and
[backlog 46](./0046-prompt-tuning-evals.md) added prompt sweeps to the
harness. [ADR 0004](../adrs/0004-api-conventions.md) sets the endpoint
conventions. Living artifacts such as the story bible, and chapter-level and
session agents, follow in backlog 49 to 53 on this plumbing, and each tunes
its own prompts the way this story does. If building reveals a flaw in the
agent ADR, amend it in the same pull request.

## Scope

* Tune a prompt for each agent this story ships, starting from backlog 48's
  first prompt and sweeping variants on its tuning cases as backlog 46
  documents, at least:
  * Separate passes per agent instead of one combined pass
  * Worked examples of a good finding and a false alarm
  * Different caps on the number of findings, and wording that asks for
    fewer, stronger findings
  * Brief reasoning before a pass, on models that offer it
* Run the finalists once on the holdout cases, have the maintainer score a
  blind sheet of finalists only, measure each variant's time and tokens per
  review, and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the
  chosen prompts and any agent still not good enough.
* Add the chosen prompts to `service/prompts/`.
* Run backlog 48's evaluation cases for each shipping agent against the
  review endpoint, as the agent ADR decides, and add cases for anything the
  endpoint adds. Include coherent documents that should produce no finding
  of a kind, so the cases catch false alarms as well as misses.
* Add the review endpoint or stream the agent ADR decides, returning findings
  with their agent, text, and passage anchors, and regenerate
  `service/openapi.json`.
* Enforce the background agents ADR's triggers and the experience ADR's
  resource targets in the service as the agent ADR decides: skip text
  already reviewed, and cap reviews per document and per period.
* Stop sending text for review while the writer has paused background work,
  if the background agents ADR lets them.
* Add background review's model to the settings from
  [backlog 57](./0057-model-settings.md) if it has landed.
* Record each review and its findings as the conversations ADR decides,
  pointing to the version of the text it read.
* Record dismissed findings as the experience ADR decides so that they do
  not return for unchanged text.
* Extend the fake provider to return findings of each shipped agent.
* Extend the `service/README.md` walkthrough to review a synthetic document.

## Acceptance criteria

* [ ] Result summaries for each shipped agent's baseline and finalist
  prompts are committed, with holdout scores reported separately, and ADR
  0010 names the chosen prompts.
* [ ] Following the walkthrough with ADR 0010's models returns findings of
  each shipped agent for a synthetic document written to contain them, and
  each anchor resolves to the passage it names.
* [ ] The evaluation cases run as the agent ADR decides and include coherent
  documents that must produce no finding of a kind.
* [ ] Reviewing unchanged text again makes no model call, and a test proves
  it with the fake provider.
* [ ] No document or finding text appears in a log line or error response,
  and a test with a synthetic marker proves it.
* [ ] `tools/check` exits 0 without provider credentials or network access to
  model providers.

## Prerequisites

* [Answer the writer in conversation from the service](./0012-first-pair-writing-agent.md)
* [Measure the background agents with the evaluation harness](./0048-background-agent-evals.md)
