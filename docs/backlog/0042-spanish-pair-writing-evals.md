---
title: Measure the pair writer in Spanish
description: Add Spanish cases to the evals/ harness, measure the shortlisted local models on them with scoring by a fluent Spanish reader, and amend the model ADR with the models Writer uses for Spanish documents.
author: Tim Park
ms.date: 2026-11-23
ms.topic: reference
subsystems:
  - evals
  - service
estimated_reading_time: 2
---

## Story

As a writer who writes in Spanish, I want the pair writer to answer and
review in Spanish as well as it does in English, on a model chosen from
measurements in Spanish, so that its suggestions fit my language rather than
an English reading of it.

## Context

The [model ADR](../adrs/0010-pair-writing-models.md) chose local models from
English cases only. Models differ more across languages than their English
results suggest, and a judge model scores Spanish prose less reliably than
English. [Backlog 41](./0041-document-language.md) records each document's
language, which tells the pair writer which language to use.

The `evals/` harness reruns any configuration against new cases, so this
story adds cases and prompts rather than new tooling. It runs when Spanish
support is about to ship, so it measures the models available then.

## Scope

* Write synthetic Spanish documents of each length, a scene, a chapter pair,
  and a manuscript, with weak passages, open threads, and disconnects, and
  coherent documents that should produce none. Write them in Spanish rather
  than translating the English cases, and have a fluent Spanish reader
  confirm every planted issue.
* Add a `language` field to cases, and make the prompts tell the model to
  answer in the document's language.
* Score whether replies and findings stay in Spanish, and whether quotes are
  copied verbatim rather than translated, alongside the existing scores.
* Run the models the model ADR shortlisted, and any newer candidates, on the
  Spanish cases. Have a fluent Spanish reader score the blind sheet; treat
  the judge model's scores as provisional.
* Amend the model ADR with the results, and state whether the chosen models
  serve Spanish documents or which models do, including on smaller machines.
* Quote only synthetic text, and commit only result summaries.

## Acceptance criteria

* [ ] Spanish cases cover each length and each kind of finding, and a fluent
  reader confirmed the planted issues.
* [ ] Result summaries for the Spanish runs are committed, with people's blind
  scores ingested.
* [ ] The model ADR names the models Writer uses for Spanish documents and
  records any gap.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Set the language of a document](./0041-document-language.md)
