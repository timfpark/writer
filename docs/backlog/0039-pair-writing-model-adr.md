---
title: Record the pair-writing model ADR
description: Evaluate local models served by Ollama on a high-end laptop for pair writing, choose the models Writer runs first, and define when it falls back to a cloud model.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer to run on a model on my own machine
whenever that model is good enough so that my text never leaves my machine,
background review costs nothing per call, and the agent works offline.
A cloud model should be used only where a local one falls short.

## Context

Writer is local-first: the service stores the workspace on the writer's
machine. Laptops with large unified memory and capable GPUs are becoming
common, and Ollama serves open-weight models on them through a local HTTP
API. If a local model can carry the
[experience ADR](./0038-pair-writing-experience-adr.md)'s journeys, the
pair writer keeps manuscripts on the machine, and background review is no
longer bounded by cost per call. Its limits become latency, memory, battery,
and heat instead.

The reference machine is a MacBook Pro with an M5 Max and 128 GB of unified
memory. Writer, the browser, and the writer's other applications share that
memory with the model.

The experiments use the conversation and background review modes, the three
example requests, and the three kinds of finding that
[backlog 38](./0038-pair-writing-experience-adr.md) describes: suggestions,
questions, and disconnects. Their results feed the experience ADR, which
decides which kinds of finding ship and the targets for latency and review
frequency. They also feed the
[agent architecture ADR](./0010-agent-architecture-adr.md), which chooses the
client that calls the models.

## Scope

* Survey the models in the Ollama library at the time that fit the reference
  machine, across families such as Llama, Qwen, Gemma, Mistral, and gpt-oss,
  and across sizes and quantizations. Shortlist the candidates to measure,
  and give reasons for each.
* Write synthetic documents of increasing length, such as a short scene, a
  chapter, and a long manuscript, some containing weak passages, open
  threads, and disconnects within and across documents, and some coherent
  documents that should produce none of them.
* Measure each candidate on the three example requests and on each kind of
  finding: usefulness and grounding in the text, false alarms on coherent
  documents, and how reliably it returns structured findings that anchor to
  passages.
* Measure what the writer feels: time to the first token of a reply, tokens
  per second, time to review each document length, and load time when a
  model is not already in memory.
* Measure the cost to the machine: memory in use with each document length's
  context, the effect on typing in the webapp during a review, and battery
  drain, heat, and fan noise during sustained background review.
* Test whether one model serves both modes, or whether a smaller model for
  background review and a larger one for conversation works better, and
  whether both fit in memory together.
* Compare the best local candidates with at least one leading cloud model on
  the same documents, scored blind where practical, so the gap is measured
  rather than assumed.
* Choose the local models Writer uses first, or conclude that none is good
  enough for a mode or a kind of finding and name the cloud model it falls
  back to.
* Define the fallback: which journeys may use a cloud model, how the writer
  consents before any text leaves the machine, and what writers on smaller
  machines get.
* Record each chosen model's license terms, and confirm they permit Writer's
  use.
* Decide how the service reaches Ollama on a host and from the development
  container, which has no access to the Mac's GPU. Confirm that `tools/check`
  needs neither Ollama nor a model.
* Keep the evaluation harness and its outputs out of the repository, quote
  only synthetic text in the ADR, and commit no cloud credentials.
* Add the ADR to the ADR index with `service` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the candidates measured on the reference machine, with
  their quality, latency, memory, and battery results for each mode and kind
  of finding, and the cloud comparison.
* [ ] The ADR names the local models Writer uses first, or states why a mode
  or kind of finding needs a cloud model, and defines the fallback and the
  writer's consent.
* [ ] The ADR states how the service reaches Ollama on a host and from the
  development container.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
