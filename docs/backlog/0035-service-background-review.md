---
title: Review documents in the background in the service
description: Add background review that runs the first paragraph- and scene-level background agents on a document, with prompts tuned on their evaluation cases, and returns findings anchored to the passages they concern.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer to read my text while I work and come
back with findings I did not think to ask for, such as weak prose, slips in
point of view, unclear passages, and questions that open other directions,
so that I get help without stopping to ask.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) picks the five
pause-triggered agents that ship first (`Weak prose`, `Clarity`, `Open
questions`, `Point of view and tense`, and `Repetition`), with their short
typing-pause trigger, structural quietness gates, per-scene and per-chapter
finding density caps, global Pause cancellation, and OS power-state battery
cadence. [ADR 0012](../adrs/0012-pair-writing-experience.md) sets the
targets for latency, memory, battery, and typing, amends ADR 0011's trigger
so a keystroke cancels a review only when it changes the text under review,
stops review while a chat reply streams, and requires `What it read` facts,
findings persisted with their quoted text, and dismissals keyed by agent
and exact text. The [agent
ADR](./0010-agent-architecture-adr.md) decides how findings anchor to
passages, how reviews start, skip unchanged text, and stay within those
targets, and how findings reach the webapp. The [conversations
ADR](./0037-agent-conversations-adr.md) decides whether each review is stored
as a conversation of its own and how it points to the version of the text it
read. [Backlog 60](./0060-scripted-chat-tab.md) and
[backlog 61](./0061-local-model-chat.md) build the agent crate, its scripted
provider, and `service/prompts/`,
[backlog 62](./0062-scripted-findings-tab.md) adds scripted findings behind a
provisional review endpoint, and
[backlog 12](./0012-first-pair-writing-agent.md) aligns them with the agent
ADR and adds the conversation cases in `evals/`, all of which this story
extends. [Backlog 48](./0048-background-agent-evals.md) wrote
cases and a first prompt for each agent and measured which are feasible, and
[evals/README.md](../../evals/README.md#sweeping-prompt-variants) documents
how to sweep prompt variants in the harness. [ADR 0004](../adrs/0004-api-conventions.md) sets the endpoint
conventions. Living artifacts such as story notes, and chapter-level and
session agents, follow in backlog 49 to 53 on this plumbing, and each tunes
its own prompts the way this story does. If building reveals a flaw in the
agent ADR, amend it in the same pull request.

## Scope

* Tune a prompt for each agent this story ships, starting from backlog 48's
  first prompt and sweeping variants on its tuning cases as
  [evals/README.md](../../evals/README.md#sweeping-prompt-variants)
  documents, at least:
  * Separate passes per agent instead of one combined pass
  * Worked examples of a good finding and a false alarm
  * Different caps on the number of findings, and wording that asks for
    fewer, stronger findings
  * Brief reasoning before a pass, on models that offer it
* Run the finalists once on the holdout cases, score them with automatic
  metrics and the judge, measure each variant's time and tokens per review,
  and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the chosen
  prompts and any agent still not good enough.
* Add the chosen prompts to `service/prompts/`.
* Run backlog 48's evaluation cases for each shipping agent against the
  review endpoint, as the agent ADR decides, and add cases for anything the
  endpoint adds. Include coherent documents that should produce no finding
  of a kind, so the cases catch false alarms as well as misses.
* Add the review endpoint or stream the agent ADR decides, returning
  advice-only findings with their agent, text, passage anchors and quoted
  text, and the facts ADR 0012's `What it read` shows, plus timing and
  tokens for the audit record, and regenerate `service/openapi.json` and
  the webapp's client. Keep backlog 62's provisional review endpoint working until
  backlog 36 moves the webapp onto the new one.
* Enforce [ADR 0011](../adrs/0011-background-agents-ux.md)'s triggers as
  ADR 0012 amends them, its zero-cost structural quietness gates, finding
  density caps, and battery policy, and ADR 0012's targets in the service
  as the agent ADR decides: skip text already reviewed, cancel a review
  only when its text changes, stop review while a chat reply streams and
  resume it at the next pause after, and cap reviews per document and per
  period.
* Cancel in-flight reviews and stop sending text for review while the
  writer has paused background work or low-battery auto-pause is active
  (unless resumed), as ADR 0011 specifies, and expose OS power policy state
  to the webapp.
* Add background review's model to the settings from
  [backlog 57](./0057-model-settings.md) if it has landed.
* Record each review and its findings as the conversations ADR decides,
  pointing to the version of the text it read.
* Persist active findings with their quoted text, and dismissals keyed by
  agent and exact passage text, as the conversations ADR decides, so a
  dismissed finding does not return for unchanged text.
* Keep the scripted provider returning findings of each shipped agent, so
  tests run without a model.
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
  it with the scripted provider.
* [ ] An edit outside the text under review leaves the review running, an
  edit inside it cancels it, and a chat turn stops review until its reply
  ends, and tests with the scripted provider prove each.
* [ ] No document or finding text appears in a log line or error response,
  and a test with a synthetic marker proves it.
* [ ] `tools/check` exits 0 without provider credentials or network access to
  model providers.

## Prerequisites

* [Keep the pair writer's conversations in the service](./0012-first-pair-writing-agent.md)
* [Measure the background agents with the evaluation harness](./0048-background-agent-evals.md)
