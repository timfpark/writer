---
title: Answer the writer in conversation from the service
description: Add the agent crate, versioned prompts, a conversation endpoint that answers the writer about the open document, and its evaluation cases.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a writer, I want to ask the pair writer about the document I am working
on, such as how to improve this text, how to develop it further, or what
other ideas to explore, and get an answer grounded in that text so that the
product's core behavior exists behind the API contract, with prompts and
evaluations in the places
[ADR 0001](../adrs/0001-monorepo-structure.md#artifact-locations) and the
[model ADR](../adrs/0010-pair-writing-models.md) set out.

## Context

ADR 0001 places agent prompts in `service/prompts/`, and backlog 6, the
service foundation, left that folder to this story rather than creating it
empty. The model ADR creates the top-level `evals/` subsystem, whose harness
scores models and prompts against synthetic cases. [ADR 0012](../adrs/0012-pair-writing-experience.md) fixes the
writer-facing conversation experience (advice-only replies, separate named
threads, open document + selection + compact book living artifacts with
opt-in attachments, streaming with immediate `Stop` cancellation, per-turn
snapshots, `What it read` audit metadata, and distinct no-provider and
failure states). The agent ADR from
[backlog 10](./0010-agent-architecture-adr.md) chooses the framework, model
provider, prompt loading, and evaluation running. It also decides what
context a conversation request carries and how tests run without a model
provider. The conversations ADR from
[backlog 37](./0037-agent-conversations-adr.md) decides how the service
stores conversations, turn snapshots, and audit records, and the resources
that expose them.
[ADR 0002](../adrs/0002-service-architecture.md) sets the crate rules, the
contract freshness test, and SSE for streamed results.
[ADR 0004](../adrs/0004-api-conventions.md) sets the endpoint's path, field
casing and nullability, problem details errors, operation ID, and, if it
streams, how the stream signals its end and failures.
[Backlog 34](./0034-assistant-pane-agent.md) connects the assistant pane to
this endpoint, and [backlog 35](./0035-service-background-review.md) builds
background review on the same crate. This story assumes the agent ADR keeps
the agent in the Rust service; if the ADR moves it to a separate process, the
ADR's pull request revises this story first. If building reveals a flaw in
the agent ADR, amend it in the same pull request.

## Scope

* Add the agent crate below `writer-api`, following the agent ADR and ADR
  0002's dependency direction.
* Create `service/prompts/` with the conversation prompt, starting from the
  one [ADR 0010](../adrs/0010-pair-writing-models.md#conversation-prompt)
  chose (`conversation-grounded`).
* Add synthetic evaluation cases to `evals/` for at least three requests
  about a passage: ideas to improve it, ideas to develop it further, and
  other ideas to explore. Run them against the conversation endpoint the way
  the agent ADR decides, and commit the result summary.
* Add the fake provider the agent ADR chooses for tests that run without a
  model provider.
* Add the conversation endpoints the conversations ADR defines, which take
  the writer's message with [ADR 0012](../adrs/0012-pair-writing-experience.md)'s
  context (open document, optional selection, available book artifacts, and
  opt-in attachments), stream advice-only replies over SSE with immediate
  cancellation on disconnect/`Stop`, return `What it read` audit metadata,
  store threads and per-turn snapshots, support permanent thread deletion,
  and regenerate `service/openapi.json`.
* Start the service without a reachable model, and answer conversation
  requests then with the problem details response the agent ADR names.
* Add the model settings, such as Ollama's address and the chosen models, to
  `service/.env.example`.
* Update `service/README.md` with how to install Ollama and pull the
  [model ADR](../adrs/0010-pair-writing-models.md)'s models, and a walkthrough
  that asks each of the three requests about a synthetic passage. Update
  `service/AGENTS.md` with the new crate, folders, settings, and commands.

## Acceptance criteria

* [ ] With the model ADR's local model running in Ollama, following
  `service/README.md` returns an answer to each of the three requests about a
  synthetic passage, on a host and in the development container.
* [ ] Without a reachable model, the service starts and the conversation
  endpoint returns the documented problem details response.
* [ ] `tools/check` exits 0 without Ollama, a model, provider credentials, or
  network access to model providers.
* [ ] Changing the endpoint without regenerating the contract makes
  `tools/check` exit 1 with a message naming `service/openapi.json`.
* [ ] No message or document text appears in a log line or error response,
  and a test with a synthetic marker proves it.
* [ ] No prompt, evaluation case, fixture, or log contains a real manuscript
  or credential.

## Prerequisites

* [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)
* [Record the agent conversations ADR](./0037-agent-conversations-adr.md)
