---
title: Record the cloud model fallback ADR
description: After writers have used the local pair writer, decide whether and where Writer falls back to a cloud model, and how writers consent before any text leaves their machine.
author: Tim Park
ms.date: 2026-11-22
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

The [model ADR](./0039-pair-writing-model-adr.md) chooses local models served
by Ollama and records any mode or kind of finding where none is good enough.
Writer ships its first pair writer on those local models alone, through
[backlog 34](./0034-assistant-pane-agent.md) and
[backlog 36](./0036-background-findings-view.md). This decision waits until
writers have used it, so the case for a cloud model rests on the gaps they
felt rather than on gaps assumed in advance.

A cloud fallback changes the promise the
[experience ADR](./0038-pair-writing-experience-adr.md) makes that text never
leaves the writer's machine, and it adds credentials, cost per call, and a
network dependency to the service the
[agent ADR](./0010-agent-architecture-adr.md) builds.

## Scope

* Collect the shortfalls of the local pair writer from the model ADR's
  recorded gaps and from use of the delivered conversation and background
  review, and decide whether any justify a cloud model. If none do, record
  that and close the decision.
* Add a cloud provider adapter to the `evals/` harness the model ADR
  creates, with placeholders only in its `.env.example`. Score at least one
  leading cloud model against the chosen local models on the same cases,
  blind where practical, for each mode and kind of finding, and commit the
  result summaries.
* Decide which journeys, modes, and kinds of finding may use a cloud model,
  and what writers on machines below the model ADR's smallest machine get.
* Decide how the writer is told and asked before any text leaves their
  machine, what they can withdraw, and what the default is.
* Record each cloud provider's terms for data retention, training on
  submitted text, and use by Writer.
* Set targets for cloud cost and latency, and how the service stays within
  them.
* Decide how cloud credentials reach the service at run time with
  placeholders only in `service/.env.example`, and confirm `tools/check`
  needs no credentials or network access to model providers.
* Amend the experience and agent ADRs where the fallback changes them, and
  add the delivery stories that build it to the backlog.
* Commit no credentials, and quote only synthetic text in the ADR.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR records the local shortfalls it weighed and the blind
  comparison, and either chooses no cloud model or names the cloud models
  and the journeys that may use them.
* [ ] If a cloud model is chosen, the ADR defines the writer's consent, the
  provider terms, the cost targets, and how credentials reach the service,
  and the backlog lists the stories that build it.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
