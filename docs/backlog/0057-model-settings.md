---
title: Choose the model for each mode in settings
description: Let the writer choose, from the models Ollama has pulled, the model behind conversation and later background review, switched at run time without a code change or restart.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to choose which local model answers me so that I can use
a newer or smaller model the moment I pull it, without waiting for a release
of Writer.

## Context

[ADR 0010](../adrs/0010-pair-writing-models.md) chose the first models and
smaller tiers for smaller machines, and expects new open-weight releases
about every six months. The
[agent architecture ADR](./0010-agent-architecture-adr.md) decides how the
service is configured with a model per mode, and
[backlog 12](./0012-first-pair-writing-agent.md) reads the model from
settings at start. [Backlog 34](./0034-assistant-pane-agent.md) connects
the assistant pane. Background review arrives with
[backlog 35](./0035-service-background-review.md), which adds its mode to
these settings. Comparing models side by side on the writer's own work
follows in [backlog 55](./0055-compare-models-in-use.md).

## Scope

* List the models Ollama has pulled, and mark the ones ADR 0010 measured
  with their measured memory and speed from the harness's result summaries.
* Store the chosen model per mode as the agent architecture ADR decides,
  starting with conversation, so a later mode adds its own entry.
* Switch the model for a mode at run time, without restarting the service,
  and expose the settings through the API under
  [ADR 0004](../adrs/0004-api-conventions.md). Regenerate
  `service/openapi.json` and the webapp's API client.
* Add a keyboard-operable, accessible settings control for each mode, and
  warn when the chosen model is not pulled, is unreachable, or exceeds the
  machine's memory as ADR 0010 sizes it.
* Add service, webapp, and browser tests with the fake provider.

## Acceptance criteria

* [ ] Switching the conversation model in settings takes effect on the next
  message without restarting the service.
* [ ] A model that Ollama has not pulled cannot be chosen silently; the
  webapp says why.
* [ ] The choice survives a reload and a service restart.
* [ ] `tools/check` exits 0 without Ollama, a model, or network access to
  model providers.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
