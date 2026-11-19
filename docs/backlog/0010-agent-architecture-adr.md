---
title: Record the pair-writing agent architecture ADR
description: Decide the agent framework, model providers, prompt loading, and evaluation running before the service builds the pair-writing agent.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want the pair-writing agent's framework,
model providers, prompt handling, and evaluation approach decided and accepted
before any agent code exists so that the first agent story implements a
deliberate choice rather than justifying one after the fact.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
makes the pair-writing agent service behavior. It places prompts in
`service/prompts/`, model integrations in service code, and evaluation cases
in `service/evals/`, and defers the agent framework and model provider to a
later service ADR. [ADR 0002](../adrs/0002-service-architecture.md) lists
"Agent framework, model providers, prompt loading, and evaluation running" as
a follow-up decision. It already requires outbound model calls on the Tokio
runtime through an async client, streaming over SSE, and an agent crate below
`writer-api` that exposes no axum, Tower, or utoipa types.
[Backlog 12](./0012-first-pair-writing-agent.md) builds what this ADR decides.

## Scope

* Choose whether to adopt an agent framework or call model providers directly,
  and compare at least two options.
* Choose the first model provider and the async client that calls it, and
  decide how the service stays open to other providers.
* Decide how credentials and provider settings reach the service at run time,
  consistent with ADR 0001's safety rules and a sanitized `.env.example`.
* Decide how prompts in `service/prompts/` are stored, versioned, and loaded:
  embedded at build time or read at run time.
* Decide how evaluation cases in `service/evals/` are written and run, and
  which parts run in `tools/check` without credentials or network access.
* Name the agent crate's responsibility and its place in ADR 0002's dependency
  direction.
* Add the ADR to the ADR index with `service` in its `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The agent ADR is accepted and listed in the ADR index.
* [ ] The ADR names the framework or direct-client approach, the first model
  provider and client, and the alternatives weighed against them.
* [ ] The ADR states how prompts load and how evaluations run, and confirms
  `tools/check` needs no credentials or network access to model providers.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
