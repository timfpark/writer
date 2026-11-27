---
title: Keep the pair writer's conversations in the service
description: Bring backlog 60 and 61's provisional conversation path in line with the agent architecture and conversations ADRs, store threads, turn snapshots, and audit records in the service, and run the conversation evaluation cases through it.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 2
---

## Story

As a writer, I want the service to keep my conversations with the pair
writer, with the text each turn discussed and what the agent read, so that
they outlast a reload or a restart, answered by a pair writer built the way
the agent ADRs decide and measured by the evaluation harness.

## Context

[Backlog 60](./0060-scripted-chat-tab.md) and
[backlog 61](./0061-local-model-chat.md) build a provisional conversation
path: an agent crate below `writer-api` with scripted and Ollama providers,
`service/prompts/` with [ADR 0010](../adrs/0010-pair-writing-models.md)'s
`conversation-grounded` prompt, and a stateless streaming endpoint, while
the webapp holds threads and turn snapshots in memory. The agent ADR from
[backlog 10](./0010-agent-architecture-adr.md) decides which parts of that
path stay, the framework or client, prompt loading, how evaluations run
against the service, and the provider tests select. The conversations ADR
from [backlog 37](./0037-agent-conversations-adr.md) decides how the
service stores conversations, turn snapshots, and audit records, and the
resources that expose them.
[ADR 0012](../adrs/0012-pair-writing-experience.md) fixes the conversation
experience they must keep, [ADR 0002](../adrs/0002-service-architecture.md)
sets the crate rules and the contract freshness test, and
[ADR 0004](../adrs/0004-api-conventions.md) sets the resource conventions.
[Backlog 34](./0034-assistant-pane-agent.md) moves the `Chat` tab onto these
resources, and [backlog 35](./0035-service-background-review.md) builds
background review on the same crate. This story assumes the agent ADR keeps
the agent in the Rust service; if the ADR moves it to a separate process,
the ADR's pull request revises this story first. If building reveals a flaw
in either ADR, amend it in the same pull request.

## Scope

* Change the provisional path as the agent ADR decides, such as adopting
  its framework or client, prompt loading, and provider selection, keeping
  every ADR 0012 behavior that backlog 60 and 61 deliver.
* Add the conversation resources the conversations ADR defines: threads
  with titles, document or book scope, and an optional finding link; turns
  with their selection, attachments, lifecycle state, document snapshot,
  and `What it read` audit record; listing and filtering by document or
  workspace; and permanent deletion that removes unreferenced snapshots
  without touching any document. Regenerate `service/openapi.json` and the
  webapp's client, and keep backlog 60's provisional endpoint working until
  backlog 34 moves the webapp onto these resources.
* Add synthetic evaluation cases to `evals/` for at least three requests
  about a passage: ideas to improve it, ideas to develop it further, and
  other ideas to explore. Run them through the service the way the agent
  ADR decides, and commit the result summary.
* Keep the scripted provider answering through the stored resources, so
  tests run without a model provider.
* Update `service/README.md` and `service/AGENTS.md` with the resources,
  storage, and commands.

## Acceptance criteria

* [ ] Threads, turns, snapshots, and audit records survive a service
  restart, and deleting a thread removes its unreferenced snapshots and
  leaves every document unchanged.
* [ ] The conversation evaluation cases run through the service as the
  agent ADR decides, and their result summary is committed.
* [ ] The conversation behaviors backlog 60 and 61 deliver still pass their
  tests.
* [ ] No message or document text appears in a log line or error response,
  and the synthetic marker test covers the new resources.
* [ ] No prompt, evaluation case, fixture, or log contains a real manuscript
  or credential.
* [ ] `tools/check` exits 0 without Ollama, a model, provider credentials, or
  network access to model providers.

## Prerequisites

* [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)
* [Record the agent conversations ADR](./0037-agent-conversations-adr.md)
