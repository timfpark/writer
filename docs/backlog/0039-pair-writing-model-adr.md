---
title: Record the pair-writing model ADR
description: Build a committed evaluation subsystem, measure local models served by Ollama on a high-end laptop for pair writing, and choose the models Writer runs, with no cloud model.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - repository
  - service
  - evals
estimated_reading_time: 5
---

## Story

As a writer, I want the pair writer to run on a model on my own machine
so that my text never leaves my machine, background review costs nothing
per call, and the agent works offline.

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

Preliminary research suggests hypotheses for the experiments to confirm or
reject, not results to adopt:

* The largest model that fits is rarely the best writer. Models of 100B
  parameters or more that mix experts, such as gpt-oss-120b, are tuned for
  code and tool use and may write flatter prose than dense models of 27B to
  31B.
* Running a dense model of 27B to 31B at 8-bit or BF16 rather than 4-bit may
  keep subtler word choice and repeat itself less.
* A mixture-of-experts model with 3B to 4B active parameters may answer fast
  enough for conversation, while a slow, heavy model may suit unattended
  background review.
* With roughly 100 GB of memory usable by the GPU, a fast conversation model
  and a heavier reviewer may stay loaded together.

Public creative-writing benchmarks, such as EQ-Bench Creative Writing, rank
how well a model writes prose. The pair writer mostly critiques the
writer's text and returns findings anchored to passages, so those rankings
can seed the shortlist but cannot replace these experiments.

The research proposes these starting candidates. Memory figures are
estimates for the weights alone, before the context's key-value cache, and
the roles are hypotheses to test.

| Model              | Type                 | Quantizations to try | Est. weights | Hypothesized role                          | License       |
|--------------------|----------------------|----------------------|--------------|--------------------------------------------|---------------|
| Hemmingway-1.5     | 27B dense            | Q8_0, BF16           | 29 to 55 GB  | Natural prose and human-sounding rewrites  | CC BY-NC 4.0  |
| Muse-Glimmer-30B   | 29.6B dense, drafter | Q8_0, BF16           | 32 to 64 GB  | Permissive all-round writer and editor     | Apache 2.0 \* |
| Qwen3.8-27B        | 27B dense            | Q8_0                 | About 29 GB  | Drafting without thinking, review with it  | Apache 2.0    |
| Gemma 4 31B        | 31B dense, StyleTune | Q8_0                 | About 33 GB  | Dialogue and stylized fiction              | Apache 2.0    |
| Gemma 4 26B-A4B    | 26B MoE, 4B active   | 8-bit MLX            | About 28 GB  | Fast conversation and brainstorming        | Apache 2.0    |
| Qwen3.6-35B-A3B    | 35B MoE, 3B active   | 4-bit                | About 23 GB  | Fast conversation and quick rewrites       | To confirm    |
| Mistral Medium 3.5 | 128B dense           | 4-bit MLX or GGUF    | 75 to 80 GB  | Slow, deep background review               | Modified MIT  |
| Qwen3.5-122B-A10B  | 122B MoE, 10B active | 4-bit                | About 70 GB  | Structural and consistency review          | To confirm    |
| gpt-oss-120b       | 120B MoE             | As released          | To measure   | Control: tuned for tools rather than prose | To confirm    |

\* Muse-Glimmer-30B carries a usage policy beside its license.

Two pairs fit the roughly 100 GB the GPU can use, if the estimates hold:
Muse-Glimmer-30B at BF16 beside Gemma 4 26B-A4B at 8-bit, or Mistral Medium
3.5 beside Qwen3.6-35B-A3B. Hemmingway-1.5's noncommercial license may rule
it out whatever its quality.

Models improve quickly, so this measurement is the first of many rather
than a one-off. The harness, the synthetic cases, and a summary of each run
are committed so that a new model, runtime, or prompt can be scored against
the same cases and compared with earlier results. They live in a new
top-level `evals/` subsystem (planned) rather than in `service/evals/`,
where [ADR 0001](../adrs/0001-monorepo-structure.md#artifact-locations)
placed evaluation cases:

* Comparing models and testing the product's prompts are one activity: the
  first varies the model with the prompts fixed, the second varies the
  prompts with the model fixed. One harness and one set of cases serve both.
* The harness compares runtimes and, under the
  [cloud fallback ADR](./0040-cloud-model-fallback-adr.md), cloud providers,
  none of which the service ships. It reaches Writer's own pair writer only
  through the service's HTTP API, so it survives wherever the
  [agent architecture ADR](./0010-agent-architecture-adr.md) places the
  agent.
* Its results inform decisions about the webapp's experience as much as the
  service's.
* It runs by hand on machines with a capable GPU, never in `tools/check`'s
  gate, on a cadence of its own.

This decision covers local models only. Writer ships its first pair writer
on them, and a [cloud fallback](./0040-cloud-model-fallback-adr.md) is
considered only after writers have used it. Where a local model falls short
for a mode or a kind of finding, this ADR records the gap rather than
choosing a cloud model.

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
  and give reasons for each. Start from the candidates in the table above,
  measure each dense model at 4-bit as well as at its higher precision, and
  replace the table's estimates and hypotheses with measured results.
* Confirm whether each shortlisted model and feature, such as speculative
  decoding with a drafter model, runs under Ollama with the GPU on Apple
  silicon. Where a candidate performs materially better under another local
  runtime, such as MLX, measure both and record whether Writer should support
  that runtime instead of or beside Ollama.
* Create the `evals/` subsystem with this measurement as its first
  deliverable, following ADR 0001's
  [Adding a subsystem](../adrs/0001-monorepo-structure.md#adding-a-subsystem)
  checklist:
  * A runner in standard-library Python that scores a named configuration of
    runtime, model, quantization, prompt, and mode against the cases. It
    reaches runtimes through adapters, starting with Ollama, so later stories
    add the service's HTTP API and cloud providers without rewriting it.
  * Synthetic cases under `evals/cases/`, the scoring rubric, and the
    procedure for blind scoring, including who or what scored each run.
    Hold back some cases from prompt tuning so that scores do not overstate
    quality.
  * One committed summary per run under `evals/results/`, recording the
    machine, runtime and version, model digest and quantization, prompt and
    case versions, scores, timings, and resource measurements. Raw model
    outputs stay in `.local/`.
  * Unit tests for the runner against a fake runtime, run by a new `evals`
    phase of `tools/check` that needs neither Ollama, a model, nor network
    access.
* Amend ADR 0001 for the new subsystem: its layout, its boundaries (it may
  call model runtimes and the service's HTTP API, never imports service
  source, and ships nothing to writers), the artifact locations for
  evaluation cases and results, and why `service/evals/` was not used. Add
  `evals` to the subsystems that
  [check_docs.py](../../tools/check_docs.py) allows, and replace mentions of
  `service/evals/` in the root and service `AGENTS.md` files.
* Write synthetic documents of increasing length, such as a short scene, a
  chapter, and a long manuscript, as `evals/` cases, some containing weak passages, open
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
  context, including each model's key-value cache per token, the effect on typing in the webapp during a review, and battery
  drain, heat, and fan noise during sustained background review.
* Test whether one model serves both modes, or whether a smaller model for
  background review and a larger one for conversation works better, and
  whether both fit in memory together.
* Choose the local models Writer uses for each mode and kind of finding.
  Where none is good enough, record the gap so the experience ADR can defer
  that kind of finding.
* State the smallest machine on which the chosen models meet the results
  above, and what a smaller model offers below it.
* Record each chosen model's license terms and usage policy, and confirm they
  permit Writer's use. Rule out a model whose license is noncommercial, such
  as CC BY-NC 4.0, unless the ADR states why Writer's use qualifies.
* Decide how the service reaches Ollama on a host and from the development
  container, which has no access to the Mac's GPU. Confirm that `tools/check`
  needs neither Ollama nor a model.
* Quote only synthetic text in the ADR and in `evals/`, and cite the
  committed result summaries rather than copying every measurement.
* Add the ADR to the ADR index with `service` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index, and ADR 0001 is
  amended for the `evals/` subsystem in the same pull request.
* [ ] Following `evals/README.md` on the reference machine reruns a
  configuration and writes a result summary comparable with the committed
  one.
* [ ] The ADR names the candidates measured on the reference machine, with
  their quality, latency, memory, and battery results for each mode and kind
  of finding.
* [ ] The ADR names the local models Writer uses for each mode and kind of
  finding, records any gap where none is good enough, and states the
  smallest machine they serve.
* [ ] The ADR states how the service reaches Ollama on a host and from the
  development container.
* [ ] `tools/check` runs the `evals` phase and exits 0 without Ollama, a
  model, or network access to model providers.

## Prerequisites

None.
