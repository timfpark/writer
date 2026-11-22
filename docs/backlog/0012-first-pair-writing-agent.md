---
title: Answer the writer in conversation from the service
description: Add the agent crate, versioned prompts, synthetic evaluation cases, and a conversation endpoint that answers the writer about the open document.
author: Tim Park
ms.date: 2026-11-22
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
[ADR 0001](../adrs/0001-monorepo-structure.md#artifact-locations) set out.

## Context

ADR 0001 places agent prompts in `service/prompts/` and evaluation cases in
`service/evals/`. Backlog 6, the service foundation, left both folders to
this story rather than creating them empty. The agent ADR from
[backlog 10](./0010-agent-architecture-adr.md) chooses the framework, model
provider, prompt loading, and evaluation running. It also decides what
context a conversation request carries, where the conversation lives, and how
tests run without a model provider.
[ADR 0002](../adrs/0002-service-architecture.md) sets the crate rules, the
contract freshness test, and SSE for streamed results.
[ADR 0004](../adrs/0004-api-conventions.md) sets the endpoint's path, field
casing and nullability, problem details errors, operation ID, and, if it
streams, how the stream signals its end and failures.
[Backlog 34](./0034-assistant-pane-agent.md) connects the assistant pane to
this endpoint, and [backlog 35](./0035-service-background-review.md) builds
background review on the same crate. If building reveals a flaw in the agent
ADR, amend it in the same pull request.

## Scope

* Add the agent crate below `writer-api`, following the agent ADR and ADR
  0002's dependency direction.
* Create `service/prompts/` with the conversation prompt.
* Create `service/evals/` with synthetic evaluation cases for at least three
  requests about a passage: ideas to improve it, ideas to develop it further,
  and other ideas to explore. Run them the way the agent ADR decides.
* Add the fake provider the agent ADR chooses for tests that run without a
  model provider.
* Add one conversation endpoint that accepts the conversation and the
  document context the agent ADR decides, and returns the reply, streamed or
  whole as the ADR decides. Regenerate `service/openapi.json`.
* Start the service without provider settings, and answer conversation
  requests then with the problem details response the agent ADR names.
* Add the provider settings to `service/.env.example` with placeholders only.
* Update `service/README.md` with a walkthrough that asks each of the three
  requests about a synthetic passage, and update `service/AGENTS.md` with the
  new crate, folders, settings, and commands.

## Acceptance criteria

* [ ] With provider settings supplied at run time, following
  `service/README.md` returns an answer to each of the three requests about a
  synthetic passage, on a host and in the development container.
* [ ] Without provider settings, the service starts and the conversation
  endpoint returns the documented problem details response.
* [ ] `tools/check` exits 0 without provider credentials or network access to
  model providers.
* [ ] Changing the endpoint without regenerating the contract makes
  `tools/check` exit 1 with a message naming `service/openapi.json`.
* [ ] No message or document text appears in a log line or error response,
  and a test with a synthetic marker proves it.
* [ ] No prompt, evaluation case, fixture, or log contains a real manuscript
  or credential.

## Prerequisites

* [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)
