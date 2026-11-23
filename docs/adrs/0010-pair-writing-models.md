---
title: "ADR 0010: Local models for pair writing"
description: Measures local models served by Ollama on the reference laptop for conversation and background review, chooses the models Writer runs, and adds the evals/ subsystem that measured them
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
status: Proposed
subsystems:
  - service
  - evals
  - repository
keywords:
  - adr
  - models
  - ollama
  - evaluation
estimated_reading_time: 2
---

## Status

Proposed on 2026-11-22. Measurements are in progress with the
[evaluation harness](../../evals/README.md).

## Decision summary

* Measure candidate local models with the committed `evals/` harness, cases,
  and result summaries, and choose from the results.
