---
title: Measure cloud models for pair writing
description: Measure inexpensive and frontier cloud models deployed in Azure AI Foundry, through the local proxy, against the chosen local models on the same synthetic cases, for quality, latency, and price per task.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - evals
estimated_reading_time: 2
---

## Story

As the maintainer, I want cloud models measured on the same cases as the
local ones, across inexpensive and frontier tiers, so that the gap in quality
and the price of closing it are known before anyone decides whether Writer
falls back to a cloud model.

## Context

The [model ADR](./0039-pair-writing-model-adr.md) measured local models
served by Ollama with the committed `evals/` harness and chose the models
Writer runs, with no cloud model. It records disconnects across a document,
and long time to a first token on a manuscript, as the local models' gaps.

This story only measures. It sends the harness's synthetic cases to cloud
providers, never a writer's text, so it does not change Writer's promise
that manuscripts stay on the machine. The
[cloud fallback ADR](./0040-cloud-model-fallback-adr.md) decides later, after
writers use the local pair writer, whether any journey may use a cloud
model and how writers consent; it cites these results. The
[experience ADR](./0038-pair-writing-experience-adr.md) may cite them to
show what local models give up.

Cloud models are deployed in Azure AI Foundry and reached through the local
proxy that [backlog 44](./0044-cloud-model-proxy-adr.md) chooses and
[backlog 45](./0045-cloud-model-proxy.md) runs with a first set of models. The
harness calls the proxy and never holds Azure credentials.

Cloud prices and models change faster than local ones, so the measurement
must rerun cheaply and record the prices it used.

## Scope

* Start from backlog 45's deployments, and deploy more through the proxy
  ADR's scripts where needed, so the measurement covers an inexpensive tier,
  such as small or flash models, and a frontier tier from at least two model
  providers in the Foundry catalog. Give reasons for each.
* Run them on the cases and prompts the model ADR used, beside its chosen
  local models, and commit the result summaries.
* Record each run's input and output tokens, and compute the price of a
  conversation reply and of a review at each document length from Foundry's
  published prices for each deployment on the run date, recorded in the
  summary.
* Estimate the monthly price for one writer at several review frequencies,
  since the experience ADR sets the real one.
* Measure latency including the network and the proxy, especially time to
  the first token on the manuscript case.
* Compare quality per dollar across tiers and against local models, and
  state where a cloud model closes the local gaps, such as disconnects.
* Keep the judge out of the candidates, note that judges may favor models
  like themselves, and have the maintainer score a blind sheet that mixes
  cloud and local outputs.
* Record the data terms for each deployment, for the cloud fallback ADR:
  how Azure and, for models sold by partners, the model provider retain and
  use submitted text.
* Set the proxy's spending cap for the run.
* Commit no credentials, and quote only synthetic text.

## Acceptance criteria

* [ ] Result summaries for every measured cloud model are committed, with
  token counts, prices and their date, latency, and scores.
* [ ] A comparison in `evals/` or the model ADR shows quality, latency, and
  price per task for each cloud tier against the chosen local models, with
  the maintainer's blind scores.
* [ ] Each deployment's data terms are recorded.
* [ ] `tools/check` exits 0 without credentials or network access to model
  providers.

## Prerequisites

* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
* [Run the cloud model proxy with a first set of Foundry models](./0045-cloud-model-proxy.md)
