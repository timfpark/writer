---
title: Measure battery drain and host typing during review
description: Run ADR 0010's open check on the chosen local models with the charger unplugged and typing in a browser on the host, record the results in ADR 0010, and revisit battery targets if they diverge.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - evals
  - webapp
estimated_reading_time: 2
---

## Story

As the maintainer, I want real unplugged battery drain and host-browser
typing measurements for the chosen local models so that background review's
power limits and scheduling rest on measurements rather than AC estimates.

## Context

[ADR 0010](../adrs/0010-pair-writing-models.md) measured sustained review on
AC power at about 60 W mean (against about 15 W idle) with no macOS thermal
or performance warning, which estimates roughly 1.2 hours of continuous
review on a 72 Wh battery. That AC measurement already bounds agent cost
well enough to design the background agents and their UX in
[backlog 47](./0047-background-agents-ux-adr.md) and the writer's journeys
in [backlog 38](./0038-pair-writing-experience-adr.md).

Two measurements from ADR 0010 remain open:

* Sustained review on the chosen models with the charger unplugged, to see
  real battery drain and whether macOS throttles differently on battery.
* Typing in a browser running on the host while a review runs, since ADR
  0010's typing test ran in the development container without the host GPU
  and therefore measured CPU contention only.

This story runs both checks without blocking the background agents ADR or
the first background review stories, and updates ADR 0010 and any downstream
battery or responsiveness targets if the measurements diverge from the
estimates.

## Scope

* Run sustained background review in `evals/` on ADR 0010's chosen models
  with the charger unplugged, recording system power draw, battery percent
  and watt-hours used, review throughput, and macOS thermal or CPU speed
  limits.
* Measure typing latency in a browser on the host on the 1 MiB synthetic
  manuscript from
  [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) while a
  sustained review runs against Ollama on the same machine, so GPU
  contention is included.
* Amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the battery and
  host-typing results, and clear its open follow-up.
* If drain or host typing diverges materially from ADR 0010's estimates,
  amend the battery policy or resource targets in the background agents ADR,
  experience ADR, or agent architecture ADR (or their open backlog stories
  if not yet accepted).
* Commit any harness updates and result summaries, keeping raw model outputs
  in `.local/evals/raw/` and quoting only synthetic text.

## Acceptance criteria

* [ ] Result summaries for the unplugged battery run on the chosen models
  are committed.
* [ ] ADR 0010 records the unplugged battery drain and host-browser typing
  measurements.
* [ ] Downstream ADRs or backlog stories are updated if the measurements
  diverge from ADR 0010's estimates.
* [ ] `tools/check` exits 0 without Ollama, a model, or unplugged hardware.

## Prerequisites

None.
