---
title: Record the cloud model fallback ADR
description: After writers have used the local pair writer, decide whether and where Writer falls back to a cloud model, and how writers consent before any text leaves their machine.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to choose a cloud model only where the local pair writer
falls short for me, and only with my consent, so that my text leaves my
machine when I decide the gain is worth it.

## Context

The [model ADR](../adrs/0010-pair-writing-models.md) chooses local models served
by Ollama and records any mode or kind of finding where none is good enough.
Writer ships its first pair writer on those local models alone, through
[backlog 61](./0061-local-model-chat.md) and
[backlog 36](./0036-background-findings-view.md). This decision waits until
writers have used it, so the case for a cloud model rests on the gaps they
felt rather than on gaps assumed in advance.
[Backlog 43](./0043-cloud-model-evals.md) has by then measured inexpensive and
frontier cloud models on the same cases, with their price per task.

A cloud fallback changes the promise
[ADR 0012](../adrs/0012-pair-writing-experience.md) makes that text never
leaves the writer's machine, and it adds credentials, cost per call, and a
network dependency to the service the
[agent ADR](./0010-agent-architecture-adr.md) builds.

## Scope

* Collect the shortfalls of the local pair writer from the model ADR's
  recorded gaps and from use of the delivered conversation and background
  review, and decide whether any justify a cloud model. If none do, record
  that and close the decision.
* Weigh backlog 43's measurements of cloud models against the chosen local
  models, and rerun them if prices or models have changed since.
* Decide which journeys, modes, and kinds of finding may use a cloud model,
  and what writers on machines below the model ADR's smallest machine get.
* Decide how the writer is told and asked before any text leaves their
  machine, what they can withdraw, and what the default is.
* Confirm each chosen provider's terms for data retention, training on
  submitted text, and use by Writer, starting from those backlog 43 records.
* Set targets for cloud cost and latency, and how the service stays within
  them.
* Decide how the service reaches cloud models through the
  [proxy ADR](./0044-cloud-model-proxy-adr.md)'s local proxy, so the
  service never holds cloud credentials, and how it behaves when the proxy
  is not running. Confirm `tools/check` needs no credentials or network
  access to model providers.
* Amend the experience and agent ADRs where the fallback changes them, and
  add the delivery stories that build it to the backlog.
* Commit no credentials, and quote only synthetic text in the ADR.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR records the local shortfalls it weighed and cites backlog 43's
  comparison, and either chooses no cloud model or names the cloud models
  and the journeys that may use them.
* [ ] If a cloud model is chosen, the ADR defines the writer's consent, the
  provider terms, the cost targets, and how the service reaches the proxy,
  and the backlog lists the stories that build it.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Measure cloud models for pair writing](./0043-cloud-model-evals.md)
* [Answer in the Chat tab from the local model](./0061-local-model-chat.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
