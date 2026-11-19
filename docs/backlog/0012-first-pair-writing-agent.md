---
title: Deliver the first pair-writing agent capability
description: Add the agent crate, versioned prompts, synthetic evaluation cases, and one contract endpoint that returns pair-writer questions about a passage.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a writer, I want to send a passage to the service and get back questions a
pair writer would ask about it so that the product's core behavior exists
behind the API contract, with prompts and evaluations in the places
[ADR 0001](../adrs/0001-monorepo-structure.md#artifact-locations) set out.

## Context

ADR 0001 places agent prompts in `service/prompts/` and evaluation cases in
`service/evals/`. [Backlog 6](./0006-service-foundation.md) leaves both folders
to this story rather than creating them empty. The agent ADR from
[backlog 10](./0010-agent-architecture-adr.md) chooses the framework, model
provider, prompt loading, and evaluation running.
[ADR 0002](../adrs/0002-service-architecture.md) sets the crate rules, the
contract freshness test, and SSE for streamed results. The capability is
stateless, so it does not wait on the storage decision. If building reveals a
flaw in the agent ADR, amend it in the same pull request.

## Scope

* Add the agent crate below `writer-api`, following the agent ADR and ADR
  0002's dependency direction.
* Create `service/prompts/` with the prompt this capability uses.
* Create `service/evals/` with synthetic evaluation cases written for the
  purpose, and run them the way the agent ADR decides.
* Add one endpoint that accepts a passage and returns pair-writer questions,
  streamed or whole as the agent ADR decides, and regenerate
  `service/openapi.json`.
* Add the provider settings to `service/.env.example` with placeholders only.
* Update `service/README.md` and `service/AGENTS.md` with the new crate,
  folders, settings, and commands, and update the ADR 0001 repository tree.

## Acceptance criteria

* [ ] With provider settings supplied at run time, following
  `service/README.md` returns questions for a synthetic passage on a host and
  in the development container.
* [ ] `tools/check` exits 0 without provider credentials or network access to
  model providers.
* [ ] Changing the endpoint without regenerating the contract makes
  `tools/check` exit 1 with a message naming `service/openapi.json`.
* [ ] No prompt, evaluation case, fixture, or log contains a real manuscript
  or credential.

## Prerequisites

* [Establish the service subsystem foundation](./0006-service-foundation.md)
* [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)
