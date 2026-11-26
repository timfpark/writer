---
title: Run the cloud model proxy with a first set of Foundry models
description: Build the local proxy the proxy ADR chooses, deploy a first set of inexpensive and frontier models in Azure AI Foundry behind it, and connect the evals/ harness to it.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - repository
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want the local proxy running with a first set of cloud
models deployed in Azure AI Foundry, and the evaluation harness able to call
them through it, so that cloud models can be measured on the same cases as
local ones without the harness holding credentials.

## Context

The [proxy ADR](./0044-cloud-model-proxy-adr.md) chooses the proxy, its
authentication to Foundry, its client-facing API, where it runs, and how it
records cost and enforces spending caps. The `evals/` harness from
[ADR 0010](../adrs/0010-pair-writing-models.md) reaches models through runtime
adapters, starting with Ollama.
[Backlog 56](./0056-story-notes-continuity-test.md) and
[backlog 48](./0048-background-agent-evals.md) use a frontier model this
story deploys as a ceiling for local results, and
[backlog 43](./0043-cloud-model-evals.md) later measures the cloud models
for price and quality.

## Scope

* Set up the proxy where and how the proxy ADR decides, with its
  configuration committed and placeholders only for any credential.
* Create the Foundry resource or project and deploy a first set of models
  with the ADR's committed scripts: at least two inexpensive models and two
  frontier models, from at least two model providers in the Foundry
  catalog. Give reasons for each, and record each deployment's model,
  version, region, and deployment type.
* Map each deployment to an alias in the proxy, and set a spending cap.
* Add a proxy adapter to the `evals/` harness for the ADR's client-facing
  API, with streaming, time to the first token, and token counts, and record
  the proxy's reported price in each result summary. Add the aliases as
  configurations in `evals/configs.json`.
* Test the adapter against a fake of the proxy's API, so `tools/check` needs
  neither the proxy, Azure credentials, nor network access.
* Document setup in `evals/README.md` and the proxy's guide: signing in to
  Azure, creating the deployments, starting the proxy, and reaching it from
  the development container.
* Run one conversation case and one review case on each deployed model as a
  smoke test, and confirm the proxy logs no prompt or completion text.

## Acceptance criteria

* [ ] Following the documentation on a host signed in to Azure starts the
  proxy and returns a reply from each deployed model through it, on the host
  and from the development container.
* [ ] `python3 -m writer_evals run <alias> --case review-harbor` writes a
  result summary with tokens, price, and timings for each deployed model.
* [ ] A request that would exceed the spending cap is refused.
* [ ] No credential is committed, and no prompt or completion text appears in
  the proxy's logs.
* [ ] `tools/check` exits 0 without the proxy, Azure credentials, or network
  access to model providers.

## Prerequisites

* [Record the cloud model proxy ADR](./0044-cloud-model-proxy-adr.md)
