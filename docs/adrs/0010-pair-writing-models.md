---
title: "ADR 0010: Local models for pair writing"
description: Measures local models served by Ollama on the reference laptop for conversation and background review with a committed evaluation harness, chooses the models Writer runs first, records where none is good enough, and decides how the service reaches Ollama
author: Tim Park
ms.date: 2026-11-23
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
  - pair writing
estimated_reading_time: 14
---

## Status

Proposed on 2026-11-23, for [backlog 39](../backlog/0039-pair-writing-model-adr.md).

The measurements ran unattended overnight on the reference machine. Two
checks need a person before this record is accepted:

* Blind scoring of 36 shortlisted outputs from six configurations, which
  confirms the provisional model where the judge and the automatic scores
  disagree. The [evaluations guide](../../evals/README.md#scoring) describes
  the sheet; the outputs stay on the machine that produced them.
* A battery run on the chosen model with the charger unplugged, and a check
  that typing in a browser on the host stays smooth while it runs. The
  measurements ran on AC power, so battery drain is estimated from power
  draw, and the typing test ran without the host's GPU.

This record amends [ADR 0001](./0001-monorepo-structure.md) by adding the
`evals/` subsystem, which replaces the planned `service/evals/`.

## Decision summary

* Run the pair writer on one local model served by Ollama, with no cloud
  model: provisionally Gemma 4 31B in Ollama's MLX build (`gemma4:31b-mlx`),
  for both conversation and background review. It judged among the best in
  both modes, found seven of nine planted issues with no false alarms,
  starts replying in about 2 seconds, and peaks at about 18 GB.
* Prefer Ollama's MLX builds on Apple silicon. For both models measured both
  ways, the MLX build ran 70 to 90% faster than the GGUF build at 4-bit, in
  less memory, with findings as good or better.
* Let the blind scoring confirm the model. Its challenger for background
  review is Muse Glimmer 30B with its speculative drafter, which found the
  most planted issues but raised more, weaker findings.
* Treat disconnects as the gap. Every model finds weak passages, and most
  find open threads; no model reliably finds contradictions within a
  chapter or across chapters, so the experience ADR should ship disconnects
  behind the other kinds or not at first.
* Require a 32 GB machine for the chosen model. Run Gemma 4 12B
  (`gemma4:12b-it-q4_K_M`, about 14 GB) on 24 GB machines and Qwen 3.5 9B
  (`qwen3.5:9b-q4_K_M`, about 9 GB) on 16 GB machines, which find fewer
  issues and, for Qwen 3.5 9B, ground fewer quotes.
* Expect a review to slow conversation: with two models loaded, sharing the
  GPU cut the conversation model's throughput by half or more while a review
  ran. One model serving both modes was not measured under that load.
* Run each model at 4-bit with its own sampling defaults, and at the lowest
  thinking level it offers that still reasons. Higher precision and deeper
  thinking did not pay for their cost.
* Reach Ollama at `OLLAMA_HOST`, defaulting to `http://127.0.0.1:11434`, with
  Ollama bound to loopback. From the development container, use
  `http://host.docker.internal:11434`, which reaches the host's loopback
  through Docker Desktop. `tools/check` needs neither Ollama nor a model.
* Measure with the committed `evals/` harness, cases, and result summaries,
  and rerun them when a model, runtime, or prompt changes.

## Context

Writer is local-first: the service keeps the workspace on the writer's
machine. [Backlog 38](../backlog/0038-pair-writing-experience-adr.md)
describes the pair writer's two modes: conversation, where the writer asks
in the assistant pane, and background review, where the agent offers
suggestions, questions, and disconnects between passages unprompted. If a
local model can do this well enough, manuscripts never leave the machine,
review costs nothing per call, and the agent works offline. Its limits become
latency, memory, power, and heat. A cloud fallback is a separate, later
decision, [backlog 40](../backlog/0040-cloud-model-fallback-adr.md), taken
after writers have used the local pair writer.

The reference machine is a MacBook Pro (Mac17,7) with an Apple M5 Max and
128 GB of unified memory, running macOS 26.7.3 and Ollama 0.40.17. Writer,
the browser, and the writer's other applications share that memory with the
model.

Preliminary research suggested that the largest model that fits is rarely
the best writer, that dense models of 27B to 31B lead creative writing
benchmarks, that 8-bit keeps subtler word choice than 4-bit, and that a fast
mixture-of-experts model could serve conversation beside a heavier reviewer.
Those benchmarks rank how well a model writes prose. The pair writer mostly
reads and critiques the writer's prose, so this record treats them as
hypotheses.

Models change quickly, so this measurement is the first of many. The
harness, cases, and summaries are committed in a new `evals/` subsystem
rather than in `service/evals/`, because the same harness compares models and
runtimes the service never ships, will reach the pair writer through the
service's HTTP API wherever the
[agent architecture ADR](../backlog/0010-agent-architecture-adr.md) places
it, and runs by hand on a capable GPU rather than in the validation gate.

## Decision drivers

* Useful, grounded findings and answers about the writer's own text, with
  few false alarms on coherent text
* Replies that start soon enough for conversation, and reviews that finish
  while the writer is still in the passage
* Memory that leaves room for Writer, the browser, and other applications,
  on the reference machine and on smaller ones
* Little effect on typing, power, and heat during sustained review
* Licenses that permit Writer's use
* A measurement that can be rerun and compared when models change

## Considered options

### Candidates

The survey covered the families in the Ollama library that fit the reference
machine: Muse Glimmer, Qwen, Gemma, Mistral, and gpt-oss, at several sizes,
quantizations, and thinking levels. Hemmingway 1.5, which the research ranked
first for prose, is not in the Ollama library and carries a noncommercial
license (CC BY-NC 4.0), so it was not measured. No Gemma 4 StyleTune variant
is in the library either; the measured Gemma 4 31B is the instruction-tuned
release.

| Configuration                | Ollama model                     | Hypothesis                                                                           | Result   |
|------------------------------|----------------------------------|--------------------------------------------------------------------------------------|----------|
| `muse-glimmer-30b-q4`        | `muse-glimmer:30b-q4_K_M`        | Permissive dense all-round writer and editor at 4-bit                                | Measured |
| `muse-glimmer-30b-q4-dflash` | `muse-glimmer:30b-q4_K_M-dflash` | Same model with its speculative drafter: faster, identical quality                   | Measured |
| `muse-glimmer-30b-q4-think`  | `muse-glimmer:30b-q4_K_M`        | Reasoning on for review                                                              | Measured |
| `muse-glimmer-30b-q8`        | `muse-glimmer:30b-q8_0`          | 8-bit keeps subtler word choice than 4-bit                                           | Measured |
| `muse-glimmer-30b-q8-dflash` | `muse-glimmer:30b-q8_0-dflash`   | 8-bit with the speculative drafter                                                   | Measured |
| `muse-glimmer-30b-bf16`      | `muse-glimmer:30b-bf16`          | Full precision: the ceiling for this model                                           | Measured |
| `muse-glimmer-30b-mlx`       | `muse-glimmer:30b-mlx`           | Ollama's MLX runner, which includes the speculative drafter, against its GGUF runner | Measured |
| `qwen3.8-27b-q4`             | `qwen3.8:27b-q4_K_M`             | Dense, low slop, thinking off for drafting                                           | Measured |
| `qwen3.8-27b-q4-think`       | `qwen3.8:27b-q4_K_M`             | Thinking on for structural review and continuity                                     | Measured |
| `qwen3.8-27b-q4-nothink`     | `qwen3.8:27b-q4_K_M`             | Thinking off: faster replies, if the model honors it                                 | Measured |
| `qwen3.8-27b-q8`             | `qwen3.8:27b-q8_0`               | 8-bit dense prose model                                                              | Measured |
| `gemma4-31b-q4`              | `gemma4:31b-it-q4_K_M`           | Dense, natural dialogue and literary voice                                           | Measured |
| `gemma4-31b-mlx`             | `gemma4:31b-mlx`                 | Ollama's MLX runner against its GGUF runner                                          | Measured |
| `gemma4-31b-q8`              | `gemma4:31b-it-q8_0`             | 8-bit dense prose model                                                              | Measured |
| `gemma4-26b-a4b-q4`          | `gemma4:26b-a4b-it-q4_K_M`       | Mixture of experts, 4B active: fast conversation                                     | Measured |
| `qwen3.6-35b-a3b-q4`         | `qwen3.6:35b-a3b-q4_K_M`         | Mixture of experts, 3B active: fastest conversation                                  | Measured |
| `qwen3.5-122b-a10b-q4`       | `qwen3.5:122b-a10b-q4_K_M`       | Heavy MoE for structural and consistency review                                      | Measured |
| `mistral-medium-3.5-q4`      | `mistral-medium-3.5:128b-q4_K_M` | Heavy dense model for slow, deep background review                                   | Measured |
| `gemma4-12b-q4`              | `gemma4:12b-it-q4_K_M`           | Small dense model for machines with 16 to 24 GB                                      | Measured |
| `qwen3.5-9b-q4`              | `qwen3.5:9b-q4_K_M`              | Small dense model for machines with 16 GB                                            | Measured |
| `gpt-oss-120b`               | `gpt-oss:120b`                   | Control: large model tuned for tools rather than prose                               | Measured |

### Runtimes and settings

Ollama runs GGUF models with llama.cpp and, on Apple silicon, some models
with its MLX runner, whose `-mlx` tags use 4-bit NVFP4 weights. Speculative
decoding (DFlash) ships as `-dflash` tags; Muse Glimmer's MLX build includes
its drafter, so `muse-glimmer:30b-mlx` and `muse-glimmer:30b-nvfp4-dflash`
are the same model. Measuring Ollama's MLX runner answered the question of a
second runtime without adding one. Each model
ran with the sampling defaults its Ollama package sets, a fixed seed, and a
context window sized to each case (8K, 32K, or 64K tokens).

Thinking needed care. Muse Glimmer with thinking off still reasons but hides
it, so it answered later than with thinking at `low`. The harness therefore
asks for the lowest named thinking level a model offers, and turns thinking
off only for models that offer just on and off. Qwen 3.8 also ran with
thinking off and at its highest level, and Muse Glimmer at `high`, to test
both ends.

## Method

The [evaluations guide](../../evals/README.md) describes the harness. In
brief:

* Eleven synthetic cases read documents of three lengths: two scenes of
  about 550 words, a pair of chapters of about 1,200 words, and an
  18,800-word manuscript. Conversation cases ask the three example requests;
  review cases plant weak passages, open threads, and disconnects within and
  across documents, and include a coherent scene and chapter where any
  disconnect is a false alarm. Four cases are held out from prompt tuning.
* Automatic scores check that a review returns valid findings, that quotes
  appear in the text, which planted issues it finds, and false alarms. A
  disconnect counts only when it cites two of the passages that conflict.
* A judge model, Qwen 3.8 Flash Next (`qwen3.8-flash-next:125b-mlx`), which is
  not a candidate, scored every output from 1 to 5 for usefulness, grounding,
  and restraint without knowing which model wrote it.
* Timing comes from Ollama's streamed responses. Peak memory is the resident
  memory of Ollama's runner processes, because Ollama's own report undercounts
  memory-mapped weights. Power is the battery controller's system power
  reading, and thermal state comes from `pmset`.

Limits of this measurement:

* One run per configuration. Repeating four configurations moved
  throughput by up to 25%, so treat small speed differences as noise.
* Eleven cases are enough to separate models that differ clearly, not to
  rank close ones. The judge's scores are provisional until people score the
  blind sheet.
* The manuscript was drafted by a local model from a written outline, and
  already contradicted itself in places, such as the supply boat's name.
  Models that reported those found real inconsistencies; only the planted
  mill contradiction is scored.
* Bandwidth limited downloads to about 10 to 17 MB/s, so only Muse Glimmer
  ran at BF16, and only the two leading families ran in MLX builds.
* Load times start from unloaded models whose files the operating system may
  still cache, not from a cold disk.

## Results

The summaries are in [evals/results/](../../evals/results/). Each records the
harness, prompt, and case digests it ran with.

### Quality and speed

| Configuration              | Quant  | Peak GB | TTFT s | Tok/s | Scene s | Chapter s | Manuscript s | Valid | Planted | False alarms | Quotes grounded % | Judge chat | Judge review |
|----------------------------|--------|---------|--------|-------|---------|-----------|--------------|-------|---------|--------------|-------------------|------------|--------------|
| gemma4-12b-q4              | Q4_K_M | 14.1    | 0.9    | 71    | 2       | 3         | 33           | 6/6   | 4/9     | 0            | 86                | 3.7        | 3.9          |
| gemma4-26b-a4b-q4          | Q4_K_M | 21.1    | 0.3    | 103   | 2       | 4         | 14           | 6/6   | 4/9     | 0            | 86                | 4.0        | 3.4          |
| gemma4-31b-mlx             | nvfp4  | 18.3    | 2.0    | 38    | 3       | 8         | 75           | 6/6   | 7/9     | 0            | 95                | 4.7        | 4.1          |
| gemma4-31b-q4              | Q4_K_M | 31.1    | 3.0    | 22    | 6       | 13        | 122          | 6/6   | 5/9     | 0            | 98                | 4.6        | 3.9          |
| gemma4-31b-q8              | Q8_0   | 43.6    | 3.0    | 11    | 11      | 38        | 160          | 6/6   | 8/9     | 1            | 93                | 4.2        | 3.7          |
| gpt-oss-120b               | MXFP4  | 63.5    | 0.6    | 77    | 13      | 14        | 48           | 6/6   | 6/9     | 0            | 58                | 3.0        | 2.2          |
| mistral-medium-3.5-q4      | Q4_K_M | 96.5    | 1.3    | 4     | 98      | 157       | 592          | 6/6   | 4/9     | 1            | 71                | 3.7        | 2.6          |
| muse-glimmer-30b-bf16      | BF16   | 54.9    | 30.9   | 9     | 61      | 78        | 229          | 6/6   | 8/9     | 0            | 97                | 4.6        | 3.2          |
| muse-glimmer-30b-mlx       | nvfp4  | 17.3    | 7.5    | 44    | 17      | 17        | 92           | 6/6   | 6/9     | 0            | 99                | 4.7        | 3.3          |
| muse-glimmer-30b-q4        | Q4_K_M | 18.6    | 17.0   | 18    | 43      | 44        | 121          | 6/6   | 7/9     | 0            | 97                | 4.4        | 2.9          |
| muse-glimmer-30b-q4-dflash | Q4_K_M | 20.6    | 14.0   | 24    | 35      | 42        | 118          | 6/6   | 8/9     | 0            | 96                | 4.8        | 3.3          |
| muse-glimmer-30b-q4-think  | Q4_K_M | n/a     | n/a    | 18    | 172     | 197       | 328          | 6/6   | 5/9     | 1            | n/a               | n/a        | 3.5          |
| muse-glimmer-30b-q8        | Q8_0   | 30.6    | 21.4   | 14    | 34      | 56        | 146          | 6/6   | 8/9     | 0            | 97                | 4.5        | 3.3          |
| muse-glimmer-30b-q8-dflash | Q8_0   | 32.3    | 14.2   | 20    | 28      | 41        | 112          | 6/6   | 8/9     | 0            | 94                | 4.3        | 3.7          |
| qwen3.5-122b-a10b-q4       | Q4_K_M | 78.9    | 1.4    | 45    | 8       | 12        | 85           | 6/6   | 5/9     | 1            | 96                | 4.0        | 3.0          |
| qwen3.5-9b-q4              | Q4_K_M | 8.8     | 0.6    | 75    | 5       | 7         | 38           | 6/6   | 5/9     | 1            | 79                | 3.6        | 2.5          |
| qwen3.6-35b-a3b-q4         | Q4_K_M | 24.5    | 0.3    | 109   | 5       | 6         | 25           | 6/6   | 3/9     | 3            | 81                | 4.2        | 2.3          |
| qwen3.8-27b-q4             | Q4_K_M | 22.5    | 46.9   | 18    | 81      | 103       | 338          | 5/6   | 5/9     | 0            | 91                | 4.9        | 3.4          |
| qwen3.8-27b-q4-nothink     | Q4_K_M | 21.4    | 2.2    | 23    | 12      | 19        | 152          | 6/6   | 4/9     | 1            | 84                | 4.3        | 2.8          |
| qwen3.8-27b-q4-think       | Q4_K_M | 21.9    | n/a    | 18    | 409     | 479       | 836          | 4/6   | 4/9     | 0            | n/a               | n/a        | 3.6          |
| qwen3.8-27b-q8             | Q8_0   | 33.8    | 77.6   | 13    | 106     | 155       | 410          | 5/6   | 5/9     | 0            | 92                | 5.0        | 3.8          |

Peak GB is the runners' resident memory, including the manuscript's context.
TTFT is the median time to the first visible token of a conversation reply.
Scene, Chapter, and Manuscript are median seconds to complete a review.
Planted counts planted issues found across the six review cases. Judge
scores are means of usefulness, grounding, and restraint.

### Planted issues found

| Configuration              | Cliché | Letter | Overwritten (ch. 1) | Overwritten (pair) | Key | Age slip | Sister left | Dawn to afternoon | Mill |
|----------------------------|--------|--------|---------------------|--------------------|-----|----------|-------------|-------------------|------|
| gemma4-12b-q4              | yes    | no     | yes                 | yes                | no  | no       | no          | no                | yes  |
| gemma4-26b-a4b-q4          | yes    | no     | yes                 | yes                | yes | no       | no          | no                | no   |
| gemma4-31b-mlx             | yes    | yes    | yes                 | yes                | yes | yes      | no          | no                | yes  |
| gemma4-31b-q4              | yes    | no     | yes                 | yes                | yes | yes      | no          | no                | no   |
| gemma4-31b-q8              | yes    | yes    | yes                 | yes                | yes | yes      | no          | yes               | yes  |
| gpt-oss-120b               | yes    | yes    | yes                 | yes                | yes | no       | yes         | no                | no   |
| mistral-medium-3.5-q4      | yes    | yes    | yes                 | yes                | no  | no       | no          | no                | no   |
| muse-glimmer-30b-bf16      | yes    | yes    | yes                 | yes                | yes | yes      | yes         | no                | yes  |
| muse-glimmer-30b-mlx       | yes    | yes    | yes                 | yes                | no  | yes      | no          | no                | yes  |
| muse-glimmer-30b-q4        | yes    | yes    | yes                 | yes                | yes | yes      | no          | no                | yes  |
| muse-glimmer-30b-q4-dflash | yes    | yes    | yes                 | yes                | yes | yes      | yes         | no                | yes  |
| muse-glimmer-30b-q4-think  | no     | yes    | yes                 | yes                | yes | yes      | no          | no                | no   |
| muse-glimmer-30b-q8        | yes    | yes    | yes                 | yes                | yes | yes      | yes         | no                | yes  |
| muse-glimmer-30b-q8-dflash | yes    | yes    | yes                 | yes                | yes | yes      | yes         | no                | yes  |
| qwen3.5-122b-a10b-q4       | yes    | no     | yes                 | yes                | no  | yes      | no          | yes               | no   |
| qwen3.5-9b-q4              | yes    | yes    | yes                 | yes                | no  | no       | yes         | no                | no   |
| qwen3.6-35b-a3b-q4         | yes    | no     | yes                 | yes                | no  | no       | no          | no                | no   |
| qwen3.8-27b-q4             | no     | yes    | yes                 | yes                | no  | yes      | yes         | no                | no   |
| qwen3.8-27b-q4-nothink     | no     | no     | yes                 | yes                | yes | no       | no          | no                | yes  |
| qwen3.8-27b-q4-think       | yes    | yes    | yes                 | no                 | no  | yes      | no          | no                | no   |
| qwen3.8-27b-q8             | yes    | yes    | yes                 | yes                | no  | yes      | no          | no                | no   |

### Findings

* Suggestions are reliable and questions mostly so. Every model found the
  clichéd paragraph or the overwritten one, and most found the unopened
  letter or the brass key.
* Disconnects are not. The age slip in a short scene was found by most
  configurations. Across chapters and at length, few succeeded: the mill's
  contradictory history in the manuscript was found by five of thirteen, the
  sister who both left and never left town by three, and the scene that moves
  from before dawn to afternoon sun by two.
* Restraint separates the models the judge prefers. Gemma 4 31B raises one
  to three findings per review and none on the coherent scene; Muse Glimmer
  raises three to six, finds more planted issues, and adds weaker ones. The
  judge rewards restraint, the planted-issue score rewards coverage, and the
  writer's preference between them is what the blind sheet decides.
* The fast mixture-of-experts models answer in under half a second at about
  100 tokens a second, but find fewer planted issues and, for Qwen 3.6, raise
  false disconnects on coherent text.
* 8-bit did not reliably beat 4-bit. Gemma 4 31B at 8-bit found more planted
  issues but raised a false alarm and scored lower with the judge, at half
  the speed and 40% more memory. Muse Glimmer found the same eight planted
  issues at 4-bit with its drafter, at 8-bit, and at full BF16 precision,
  which needed 55 GB and ran at 9 tokens a second.
* Deeper thinking cost more than it returned. At their highest levels, Qwen
  3.8 and Muse Glimmer took three to seven minutes per review, and Qwen 3.8
  twice spent its whole 12,000-token budget thinking and returned nothing.
  With thinking off, Qwen 3.8 answered in 2 seconds but its findings were
  the weakest it produced.
* Muse Glimmer's speculative drafter raised throughput by about a third with
  the same findings, for about 2 GB more memory.
* Ollama's MLX runner was the largest single gain. Gemma 4 31B ran at 38
  tokens a second against 22 for the GGUF build, reviewed the manuscript in
  75 seconds against 122, peaked at 18 GB against 31, and found seven planted
  issues against five. Muse Glimmer's MLX build, which includes its drafter,
  ran at 44 tokens a second against 24 for the GGUF build with its drafter.
* The small models answer within a second. Gemma 4 12B found four planted
  issues with no false alarms; Qwen 3.5 9B found five but raised a false
  alarm and grounded a fifth of its quotes in nothing.
* Bigger was not better. Qwen 3.5 122B-A10B needed 79 GB and found five
  planted issues with a false alarm, and judged below the 31B models.
  Mistral Medium 3.5, a dense 128B model, needed 97 GB, generated 4 tokens a
  second, took ten minutes to review the manuscript, and found four planted
  issues with a false alarm.
* gpt-oss 120B, the control tuned for tools, was fast and found six planted
  issues, but only 58% of its conversation quotes appear in the text, and
  the judge scored it lowest of the large models in both modes.
* A long document dominates latency. Reading the 25,000-token manuscript
  takes 15 to 100 seconds before the first token, depending on the model, so
  conversation about a whole manuscript and review of one need the agent ADR
  to reuse cached context or narrow what is sent.

### Two models together

| Chat model        | Reviewer                   | Both loaded | Peak GB | TTFT idle s | TTFT during review s | Tok/s idle | Tok/s during review | Reviews |
|-------------------|----------------------------|-------------|---------|-------------|----------------------|------------|---------------------|---------|
| gemma4-26b-a4b-q4 | muse-glimmer-30b-q8        | yes         | 48.0    | 0.6         | 1.0                  | 81.4       | 27.3                | 2       |
| gemma4-31b-mlx    | muse-glimmer-30b-mlx       | yes         | 35.6    | 4.1         | 0.4                  | 26.8       | 14.6                | 4       |
| gemma4-31b-q4     | muse-glimmer-30b-q4-dflash | yes         | 45.2    | 2.2         | 4.0                  | 29.6       | 10.5                | 4       |

Each pair stayed loaded together. While a review ran, the conversation
model's throughput fell by half to two thirds, because both share the GPU.
The pair test repeats the same conversation prompts after the idle phase, so
Ollama's prompt cache makes the first tokens during review look faster than
they are; compare throughput, not first tokens. The MLX pair peaked at 36 GB,
so two models fit a 48 GB machine. One model serving both modes saves the
second load; how much a review slows its conversation replies is for the
agent ADR to measure with the service's scheduling.

### Sustained review, power, and typing

| Config                     | Minutes | Reviews | Mean W | Max W | Min CPU speed limit | Max thermal warning | Power | Battery used % |
|----------------------------|---------|---------|--------|-------|---------------------|---------------------|-------|----------------|
| muse-glimmer-30b-q4-dflash | 20      | 26      | 60.0   | 81.4  | n/a                 | n/a                 | AC    | n/a            |
| gemma4-31b-mlx             | 15      | 112     | 61.7   | 69.1  | n/a                 | n/a                 | AC    | n/a            |

Back-to-back reviews of the chapter pair drew about 60 W on average with
either model, against about 15 W idle, with no thermal or performance
warning from macOS. Gemma 4 31B's MLX build finished a review every 8
seconds, 112 in 15 minutes, and peaked at 69 W; Muse Glimmer with its drafter
on the GGUF runner peaked at 81 W. On the machine's 72 Wh battery, 60 W is
about 1.2 hours of continuous review. Real background review runs only after
pauses in writing, so its drain depends on the frequency the experience ADR
sets.

Typing was measured in the development container with the browser test's
1 MiB manuscript, before and during a sustained review on the host:

| CPU throttling | Idle p95 ms | During review p95 ms | During review max ms |
|----------------|-------------|----------------------|----------------------|
| 1x             | 21          | 17                   | 23                   |
| 4x             | 19          | 25 to 27             | 123                  |

Every run stayed within ADR 0008's 50 ms target at the 95th percentile. The
container's browser renders without the GPU, so this measures CPU contention
only; a writer's browser on the host also shares the GPU with the model,
which needs checking by hand.

## Decision

### Models Writer runs first

| Machine memory | Model                  | Peak GB | Why                                                                          |
|----------------|------------------------|---------|------------------------------------------------------------------------------|
| 32 GB or more  | `gemma4:31b-mlx`       | 18      | Judged well in both modes, 7 of 9 planted issues, no false alarms, 2 s reply |
| 24 GB          | `gemma4:12b-it-q4_K_M` | 14      | Fast, no false alarms, fewer issues found                                    |
| 16 GB          | `qwen3.5:9b-q4_K_M`    | 9       | Fits; finds some issues but grounds fewer quotes and raises false alarms     |

One model serves both modes. The blind scoring confirms it against its
challenger for background review, Muse Glimmer 30B with its drafter
(`muse-glimmer:30b-q4_K_M-dflash`, or `muse-glimmer:30b-mlx` for speed),
which found eight planted issues but raised more, weaker findings that the
judge marked down. If people prefer that coverage, run it for review beside
Gemma 4 31B for conversation on machines with 48 GB or more.

Off Apple silicon, where the MLX builds do not run, use the GGUF build at
4-bit, `gemma4:31b-it-q4_K_M`, which needs about 31 GB.

Run every model at 4-bit, with its package's sampling defaults and the
lowest thinking level that reasons, as the
[configurations](../../evals/configs.json) record. Size the context to the
document, and reserve 4,000 output tokens for a review and 2,000 for a
reply, as the runs did.

### Kinds of finding

Suggestions and questions are good enough to ship. Disconnects within a
scene are found often; disconnects across a chapter or a manuscript are not,
so the experience ADR should treat them as the gap: ship them later, behind
a clear label, or only from an on-request review that can take longer.

### Smallest machine

Gemma 4 31B's MLX build peaks at about 18 GB with a manuscript in context.
With macOS, the browser, and Writer needing about 12 GB, that is a 32 GB
machine. The table above sets the smaller tiers the same way. None of these
limits was measured on a smaller machine; they follow from peak memory.

### Licenses

Gemma 4, Qwen 3.5, Qwen 3.6, and Qwen 3.8 ship with the Apache License 2.0
in their Ollama packages. Ollama's library lists Muse Glimmer as Apache 2.0,
but its package carries no license text, and the research reported a usage
policy beside it; confirm Meta's terms before Muse Glimmer ships.
Hemmingway 1.5's noncommercial license rules it out.

### Reaching Ollama

The service will read Ollama's address from `OLLAMA_HOST`, as Ollama and the
harness do, defaulting to `http://127.0.0.1:11434`. Keep Ollama bound to
loopback, its default. The development container has no access to the Mac's
GPU, so the service and harness running there use
`http://host.docker.internal:11434`; Docker Desktop forwards that name to
the host's loopback, which was verified with a loopback-only server.
`tools/check` runs the harness's unit tests against a fake runtime and a fake
of Ollama's HTTP API, so it needs neither Ollama, a model, nor network
access.

### The evaluations subsystem

`evals/` holds a standard-library Python harness, the synthetic cases, the
candidate and judge prompts, the configurations, and the committed result
summaries, as [ADR 0001](./0001-monorepo-structure.md#repository-layout) now
records. Raw model output stays in `.local/evals/raw/`. The `evals` phase of
`tools/check` runs its unit tests after the `service` phase.

## Consequences

Positive outcomes:

* The pair writer can run entirely on the writer's machine, offline, at no
  cost per call, with a measured model and known limits.
* The next model, quantization, runtime, or prompt is scored against the
  same cases and compared with these summaries.
* The experience and agent ADRs start from measured latency, memory, power,
  and finding quality rather than assumptions.

Trade-offs and risks:

* Disconnects, the most distinctive kind of finding, are the least reliable,
  so the first release may not offer them.
* Conversation about a whole manuscript waits 15 to 100 seconds for the first
  token unless the agent reuses cached context or sends less.
* The chosen model needs a 32 GB machine; smaller machines get a different
  model and lower quality.
* The MLX builds run only on Apple silicon, so other platforms need the GGUF
  build and more memory.
* Eleven cases and one judge are a thin basis. Adding cases changes the case
  digest, so earlier summaries stop comparing directly until rerun.
* The judge rewards restraint and may undervalue coverage; people's scores
  outrank it.

## Revisit triggers

* A new release in a measured family, or a new family in the Ollama library
  that fits the reference machine: run it with the same cases.
* A prompt change in the agent ADR or later: rerun the chosen configurations.
* People's blind scores disagree with the provisional reviewer.
* Ollama changes how it runs a model, such as an MLX runner or speculative
  decoding for the chosen model: rerun it on the new runtime.
* A writer on a 32 GB or 16 GB machine finds the smaller model unhelpful.
* Writer supports a language other than English: measure the models on
  cases in that language, as backlog 42 does for Spanish.

## Follow-ups

* [Backlog 38](../backlog/0038-pair-writing-experience-adr.md): set latency
  targets from these measurements, decide how disconnects ship, and decide
  how often reviews run given about 60 W while one runs.
* [Backlog 10](../backlog/0010-agent-architecture-adr.md): reuse cached
  context for long documents, size the context to the document, call Ollama
  through `OLLAMA_HOST`, and run the agent's cases through the `evals/`
  harness against the service's HTTP API.
* [Backlog 40](../backlog/0040-cloud-model-fallback-adr.md): score cloud
  models on the same cases with a cloud adapter in `evals/`.
* [Backlog 42](../backlog/0042-spanish-pair-writing-evals.md): measure the
  models on Spanish cases before Spanish documents get a pair writer. This
  record's choices hold for English only.

## References

* [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md)
* [Ollama library](https://ollama.com/library)
* [Muse Glimmer in the Ollama library](https://ollama.com/library/muse-glimmer)
* [EQ-Bench Creative Writing](https://eqbench.com/creative_writing.html)
