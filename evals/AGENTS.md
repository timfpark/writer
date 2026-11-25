---
title: Evaluations Agent Guide
description: Purpose, boundaries, operational rules, governing decisions, and exact commands for coding agents working in evals/
---

## Purpose and boundaries

`evals/` is Writer's evaluation harness: a standard-library Python package,
[writer_evals](./writer_evals/), that scores models and prompts against
synthetic cases and writes a summary of each run. People start with
[README.md](./README.md).

| Path                             | Responsibility                                                             |
|----------------------------------|----------------------------------------------------------------------------|
| [writer_evals/](./writer_evals/) | Runtimes, case loading, prompts, scoring, runner, judge, sheet, and report |
| [cases/](./cases/)               | Synthetic case files and the documents they read                           |
| [prompts/](./prompts/)           | Candidate pair-writing prompts and the judge prompts, as `.txt` templates  |
| [configs.json](./configs.json)   | Named configurations of runtime, model, think setting, and options         |
| [results/](./results/)           | Committed run summaries that decisions cite                                |
| [tests/](./tests/)               | Unit tests against a fake runtime and a fake of Ollama's HTTP API          |

* The harness reaches models only through runtime adapters in
  [runtimes.py](./writer_evals/runtimes.py), and reaches Writer's own pair
  writer, when it exists, only through the service's HTTP API. It never
  imports `service/` or `webapp/` source.
* Nothing in `evals/` ships to writers, and `tools/check` never runs a model.

## Operational rules

* Use only the Python standard library, and keep the code compatible with
  Python 3.9, the oldest version `tools/check` accepts.
* Write only synthetic prose in cases, prompts, tests, and summaries. Never
  commit model output; summaries keep its digest, and raw output stays in
  `.local/evals/raw/`.
* Add a runtime as an adapter with the same methods as `OllamaRuntime`, and a
  fake-backed test. Read addresses and any credential from the environment
  and document them in [.env.example](./.env.example) with placeholders.
* Keep a case's planted passages verbatim in its documents; the loader
  rejects them otherwise. Do not tune prompts against `holdout` cases.
* Changing a prompt, case, or document changes its digest, so earlier
  summaries no longer compare directly. Rerun the configurations a decision
  cites before replacing its numbers.
* Never let a judge configuration score a model it is a candidate against.
* Commands exit 0 on success, 1 on a failed generation, and 2 on usage
  errors and missing models or runtimes, naming what is missing.
* Toolchain, dependency, or environment changes update `.devcontainer/`,
  version pins, and setup documentation in the same change.

## Governing decisions

* [ADR 0001](../docs/adrs/0001-monorepo-structure.md): repository layout,
  subsystem boundaries, artifact locations, and `tools/check`
* [ADR 0010](../docs/adrs/0010-pair-writing-models.md): the local models
  Writer runs, how they were measured, and how the service reaches Ollama

## Commands

Run from `evals/`:

```bash
python3 -m unittest discover --start-directory tests --top-level-directory .
python3 -m writer_evals list
python3 -m writer_evals run <config>... [--case <id>] [--task review] [--split tune]
python3 -m writer_evals report
```

From the repository root, `tools/check` runs the unit tests in its `evals`
phase.
