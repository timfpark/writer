---
title: Record the cloud model proxy ADR
description: Choose a local proxy that gives Writer's tools one loopback endpoint for cloud models hosted in Azure AI Foundry, holding the credentials, routing models, recording use and cost, and enforcing spending caps.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - repository
  - evals
  - service
estimated_reading_time: 3
---

## Story

As the maintainer, I want every call to a cloud model to go through a local
proxy that holds the credentials and enforces limits, so that neither the
evaluation harness nor, later, the service handles cloud credentials, talks
to a provider directly, or can spend without a cap.

## Context

The [model ADR](./0039-pair-writing-model-adr.md) runs the pair writer on
local models served by Ollama, reached at `OLLAMA_HOST` on loopback.
[Backlog 43](./0043-cloud-model-evals.md) measures cloud models on the same
cases, and the [cloud fallback ADR](./0040-cloud-model-fallback-adr.md) may
later let some journeys use one. Both need cloud models reached the same way.

Cloud models are hosted in Azure AI Foundry. A Foundry resource or project
exposes models from several providers through an OpenAI-compatible
`/openai/v1` endpoint, where a request names its deployment in the `model`
field, and supports keyless Microsoft Entra ID authentication as well as API
keys. Some deployments support the Responses API and others only Chat
Completions.

A local proxy keeps those concerns in one place. Clients call one
OpenAI-compatible endpoint on loopback with a model alias; the proxy
authenticates to Foundry, maps the alias to a deployment, and records tokens
and cost. The proxy could also route to Ollama, so clients speak one API for
local and cloud models.

[ADR 0001](../adrs/0001-monorepo-structure.md) requires that no credential is
committed, that Python and npm packages install only through the registry
proxies, and that a new subsystem follows its checklist.
[ADR 0004](../adrs/0004-api-conventions.md) keeps manuscript text out of
logs.

## Scope

* Compare at least three ways to proxy, such as an existing gateway like
  LiteLLM, a lightweight gateway like Envoy AI Gateway, and a small proxy
  written for Writer, against calling Foundry directly from each client.
  Weigh dependencies and their install path through the registry proxies,
  Entra ID support, streaming, token and cost accounting, spending caps,
  logging without request or response text, and maintenance.
* Decide how the proxy authenticates to Foundry: Entra ID through the Azure
  CLI's login or a managed identity, or an API key, and where any key lives,
  with placeholders only in an `.env.example`. Prefer keyless.
* Decide the client-facing API: OpenAI-compatible Chat Completions, the
  Responses API, or both, with streaming and usage counts, and how a model
  alias maps to a Foundry endpoint and deployment.
* Decide whether the proxy also routes local models to Ollama, so the
  harness and the service use one endpoint for both.
* Decide where the proxy runs: on the host on loopback, its port, how it
  starts and stops, and how the development container reaches it, following
  the model ADR's `host.docker.internal` approach.
* Decide how it records each call's model, tokens, latency, and price, and
  how it enforces a spending cap per run and per period, never logging
  prompts or completions.
* Decide where the proxy's configuration and any code live: a new top-level
  subsystem, `tools/`, or `evals/`, and amend ADR 0001 if it adds a
  subsystem.
* Decide how Foundry resources and deployments are created and recorded,
  such as committed Azure CLI or Bicep scripts with no secrets, and which
  region and deployment types to use.
* Confirm `tools/check` needs neither the proxy, Azure credentials, nor
  network access, by testing clients against a fake proxy.
* Prototype the leading option against a Foundry deployment, keep the
  prototype out of the repository, and record what it showed.
* Add the ADR to the ADR index with `repository`, `evals`, and `service` in
  its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the proxy, its authentication to Foundry, its
  client-facing API, where it runs and how the development container
  reaches it, and how it records cost and enforces caps.
* [ ] The ADR records the options weighed and what the prototype showed.
* [ ] No credential is committed, and `tools/check` exits 0 without Azure
  credentials or network access to model providers.

## Prerequisites

* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
