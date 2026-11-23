---
title: Record the pair-writing experience ADR
description: Decide end to end how writers work with the pair writer, in conversation and in background review, tested with a throwaway prototype and grounded in what local models showed they can do.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the writer's experience of the pair
writer decided end to end, tested with a prototype, and grounded in what the
models can do, before its implementation is chosen so that where the agent
runs, how it is built, and how its conversations are stored serve that
experience rather than constrain it.

## Context

The [README](../../README.md#overview) promises an agent that is always there
with the writer: it asks questions, suggests other ideas, and checks prose
for quality and consistency. It works in two modes:

* In conversation, the writer asks in the assistant pane, for example "Give
  me some ideas about how I can improve this text", "How can I further
  develop this text?", or "What other ideas should I explore?", and the agent
  answers about the text in front of the writer.
* In background review, the agent reads the writer's text while they work
  and offers findings unprompted: suggestions to improve the text, questions
  that open other directions, and places where passages do not connect
  cleanly with each other.

[ADR 0001](../adrs/0001-monorepo-structure.md) and
[ADR 0002](../adrs/0002-service-architecture.md) placed the agent in a crate
of the Rust service before anyone described how writers would use it, and
background review has since put that assumption in question. This decision
comes first so that the [agent architecture ADR](./0010-agent-architecture-adr.md)
and the [agent conversations ADR](./0037-agent-conversations-adr.md) start
from a described experience instead of repeating that mistake.

Backlog 25 built the assistant pane around the `Assistant` interface in
[conversation.ts](../../webapp/src/workspace/conversation.ts), answered by a
stub. [ADR 0007](../adrs/0007-webapp-interface.md) sets the interface
foundation the experience builds on, and
[ADR 0008](../adrs/0008-editor.md#follow-up-decisions) leaves open how the
pair writer's suggestions are shown and accepted.

The largest risk is not how the agent is built but whether its unprompted
findings help more than they distract, on a model the writer can run. The
[model ADR](./0039-pair-writing-model-adr.md) measures that first with local
models served by Ollama. Its results set what this experience can promise:
which kinds of finding are good enough to ship and how quickly replies
arrive. Text never leaves the writer's machine; the
[cloud fallback ADR](./0040-cloud-model-fallback-adr.md) revisits that only
after writers have used the local pair writer.

## Scope

* Describe each journey end to end, from the writer's first action to its
  last visible result:
  * Asking in the pane about the open document or a selection, including the
    three example requests above
  * Writing while background review runs, and noticing its findings
  * Returning later to findings and to earlier conversations
  * Answering a question the agent raised
  * Following a finding to its passage, then acting on it or dismissing it
  * Reviving a past conversation, and seeing the text as it was when the
    conversation took place
  * Seeing what the agent read and why it said what it did
  * Turning background review off, and deleting conversations
  * Using Writer with no provider configured, offline, or after an agent
    failure
* Define the kinds of finding, at least suggestions, questions, and
  disconnects, and what the writer sees for each.
* Decide what the agent pays attention to from the writer's point of view:
  the open document, the selection, other documents in the folder or
  workspace, or earlier conversations.
* Decide when background review runs as the writer sees it, such as after a
  pause, on save, or on request, and how often it may surface findings
  before it becomes noise.
* Decide where conversations and findings appear: one conversation, separate
  chats like those in coding assistants, findings grouped per document, or a
  separate list. Decide how unread results signal while the pane is
  collapsed, without interrupting typing or moving focus.
* Decide what happens to a finding whose passage the writer has since edited
  or deleted.
* Decide whether suggestions stay advice, or whether a writer can accept a
  proposed rewrite into the document, and how that meets undo.
* Decide the default for background review.
* Set targets the implementation must meet, such as how soon a reply starts
  to appear, how often reviews may run, limits on memory and battery, and no
  measurable effect on typing in
  [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts). Ground
  each target in the model ADR's measurements.
* Build a throwaway, clickable prototype of the journeys with scripted
  responses, keep it out of the repository, try the journeys with it, and
  record in the ADR what the prototype changed in the design.
* Decide which kinds of finding ship first from the model ADR's results, and
  cut or defer any kind that does not earn its place.
* Resolve how suggestions are shown and accepted from ADR 0008's follow-up
  decision, and link to this ADR from it.
* State what the experience requires of the agent architecture and
  conversations ADRs, and revise backlog 10, 37, 12, 34, 35, and 36 where
  the experience departs from them.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR describes every journey in scope end to end, including the
  no-provider, offline, and failure states.
* [ ] The ADR records what the prototype showed, and which kinds of finding
  ship first, which are deferred, and why, citing the model ADR's results.
* [ ] The ADR states the targets and requirements that backlog 10 and backlog
  37 must meet, and those stories reflect them.
* [ ] ADR 0008's follow-up decision on showing and accepting suggestions links
  to the ADR.
* [ ] No prototype, credential, or real manuscript is committed.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
