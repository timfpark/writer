---
title: Answer in the Chat tab from the local model
description: Put ADR 0010's local conversation model and tuned prompt behind backlog 60's provisional endpoint, calling Ollama directly from the service, so the Chat tab streams grounded advice on the writer's machine before the agent architecture is chosen.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a writer, I want the Chat tab to answer me with the local model Writer
chose, grounded in the document I have open, so that I get real advice
about my text without it leaving my machine.

## Context

Backlog 60 built
[ADR 0012](../adrs/0012-pair-writing-experience.md)'s Chat tab against a
scripted pair writer behind a provisional, stateless streaming endpoint in
an agent crate. This story replaces the script with the model, so the
maintainer learns how the pair writer feels and performs in real use while
backing out is still cheap.

[ADR 0010](../adrs/0010-pair-writing-models.md) chose `gemma4:31b-mlx` with
the [conversation-grounded](../../evals/prompts/conversation-grounded.txt)
prompt for conversation, and decides that the service reaches Ollama at
`OLLAMA_HOST`, defaulting to `http://127.0.0.1:11434`, and at
`http://host.docker.internal:11434` from the development container. Its
runs started replying in about 2 seconds on a scene, about 3 seconds more
per further 1,000 words read, and 0.3 to 0.6 seconds when Ollama had
already processed the prompt. ADR 0012 sets its first-token targets from
those runs, limits a turn's reading to about 19,000 words, the context
ADR 0010 measured memory with, and asks for immediate cancellation on
`Stop`, a readiness report naming what is missing, and ADR 0004's
`unavailable`, `upstreamFailed`, and `upstreamTimeout` codes for failures.

[ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
defers choosing an agent framework to the
[agent architecture ADR](./0010-agent-architecture-adr.md). This story calls
Ollama directly as a provisional choice that the agent architecture ADR
keeps, changes, or replaces, citing what this story measured. Evaluation
cases that run through the service wait for that ADR and
[backlog 12](./0012-first-pair-writing-agent.md).

## Scope

* Add an Ollama provider to the agent crate that streams from Ollama's chat
  API through an async HTTP client on the Tokio runtime, reaching Ollama at
  `OLLAMA_HOST` as ADR 0010 decides, with the conversation model a setting
  that defaults to `gemma4:31b-mlx`. Record why the client was chosen in
  the pull request.
* Create `service/prompts/` with ADR 0010's `conversation-grounded` prompt,
  and report its name and digest as the prompt version in `What it read`.
* Send the model backlog 60's reading, never the whole workspace, with the
  text already read first so Ollama can reuse its processed prompt on a
  follow-up, as ADR 0010's cached runs did.
* Cancel the model request as soon as the writer stops or the connection
  closes.
* Report through backlog 60's readiness check whether Ollama answers at
  `OLLAMA_HOST` and whether each configured model is installed. Answer a
  turn that cannot start with
  [ADR 0004](../adrs/0004-api-conventions.md)'s `503` `unavailable` before
  the stream, and end a stream that fails with an `error` event carrying
  `upstreamFailed`, or `upstreamTimeout` when Ollama stops sending.
* Return Ollama's first-token time, total time, and token counts in each
  reply's `done` event for the measurements below and the audit record
  backlog 37 defines; `What it read` does not show them.
* Select the Ollama provider by default and keep the scripted provider for
  tests and demonstrations. Test the Ollama provider's streaming,
  cancellation, and failures against a fake of Ollama's API, so
  `tools/check` needs no model.
* Add the new settings to `service/.env.example` and
  [service/README.md](../../service/README.md)'s configuration table, add a
  walkthrough that installs Ollama, pulls the model, and asks each starter
  prompt about a synthetic passage, and update `service/AGENTS.md` with
  `service/prompts/` and the settings.
* Measure first-token time and streaming rate through the service on the
  reference machine for each starter prompt on a scene, a chapter, and a
  document past the reading limit, for a first read and a follow-up, and
  record them in the pull request against ADR 0012's targets for the agent
  architecture ADR to cite.

## Acceptance criteria

* [ ] With ADR 0010's model pulled in Ollama, following `service/README.md`
  makes the Chat tab stream an advice-only answer to each starter prompt
  about a synthetic passage, quoting it verbatim, on the host and from the
  development container.
* [ ] `What it read` names `gemma4:31b-mlx`, `conversation-grounded` with
  its digest, and the sources read, and each reply's `done` event carries
  the timing and token counts Ollama reported.
* [ ] `Stop` ends the model request, and a test against the fake Ollama API
  proves it.
* [ ] With Ollama stopped or the model not installed, the service starts,
  the Chat tab names what is missing and points to `service/README.md`,
  starting Ollama clears the notice without a reload, and writing and
  saving work unchanged.
* [ ] The pull request records first-token time and streaming rate through
  the service, for first reads and follow-ups, against ADR 0012's
  targets.
* [ ] No message, document, or reply text appears in a log line or error
  response, and the synthetic marker test covers the Ollama provider.
* [ ] `tools/check` exits 0 without Ollama, a model, or network access to
  model providers.

## Prerequisites

None.
