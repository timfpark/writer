---
title: Writer evaluations
description: How to run Writer's evaluation harness, which scores models and prompts against synthetic cases and commits a summary of every run
---

## Overview

`evals/` holds Writer's evaluation harness, the synthetic cases it reads, and
a committed summary of every run. It answers two questions with one set of
cases:

* Which model, at which quantization and on which runtime, serves each pair
  writing task best on a given machine?
* Does a change to a prompt, or later to the service's pair writer, keep or
  improve the results?

The [pair-writing model ADR](../docs/adrs/0010-pair-writing-models.md) made
the first measurements with it. Nothing here ships to writers, and
`tools/check` runs only the harness's unit tests, never a model.

## Requirements

* Python 3.9 or newer, standard library only.
* [Ollama](https://ollama.com) serving the models a configuration names, on
  a machine with a capable GPU. Pull a model with `ollama pull <model>`.
* On macOS, power and thermal readings come from `ioreg` and `pmset` and need
  no `sudo`. Other systems record them as unavailable.

The harness reads Ollama's address from `OLLAMA_HOST`, as Ollama does, and
defaults to `http://127.0.0.1:11434`. Keep Ollama bound to loopback, its
default. From the development container, which has no access to the Mac's
GPU, reach the host's Ollama through Docker Desktop:

```bash
export OLLAMA_HOST=http://host.docker.internal:11434
```

[.env.example](./.env.example) lists the setting.

## Running

Run every command from `evals/`:

```bash
cd evals
python3 -m writer_evals list
python3 -m writer_evals run qwen3.8-27b-q4 gemma4-26b-a4b-q4
python3 -m writer_evals run muse-glimmer-30b-q8 --task review --split tune
python3 -m writer_evals run gemma4-31b-mlx --task conversation --split tune --prompt conversation-grounded
python3 -m writer_evals pair gemma4-26b-a4b-q4 muse-glimmer-30b-q8 --review-case review-saltworks
python3 -m writer_evals sustained muse-glimmer-30b-q4 --case review-saltworks --minutes 30
python3 -m writer_evals judge judge-qwen3.8-flash-next results/2026-11-22-*.json
python3 -m writer_evals report --split holdout
```

| Command     | What it does                                                                                              |
|-------------|-----------------------------------------------------------------------------------------------------------|
| `list`      | Lists the configurations in [configs.json](./configs.json), prompts in [prompts/](./prompts/), and cases. |
| `run`       | Unloads every model, times a load, runs the chosen cases, scores them, and writes one summary per config. |
| `pair`      | Loads a conversation model and a reviewer together and times conversation replies while reviews run.      |
| `sustained` | Reviews one case repeatedly, sampling power and thermal state, and battery level when unplugged.          |
| `judge`     | Scores outputs with a judge configuration that sees no model names, and adds the scores to the summaries. |
| `rescore`   | Recomputes the automatic scores from raw output after the scoring rules or case expectations change.      |
| `report`    | Prints the summaries as Markdown tables for ADRs and pull requests (filter with `--split` and `--task`).  |

The commands exit 0 on success, 1 when a generation fails, and 2 on a usage
error, an unknown configuration or case, or a model or runtime that is not
available, naming what is missing.

## Cases

Each case in [cases/](./cases/) is a JSON file naming its task
(`conversation` or `review`), its `split`, its length (`scene`, `chapter`,
or `manuscript`), and the documents it reads from
[cases/documents/](./cases/documents/). Documents are synthetic Markdown, as
Writer stores it, and are test data rather than documentation.

* A conversation case names either one of the three example requests
  (`improve`, `develop`, `explore`) or a custom question string, and
  optionally a verbatim `selection`.
* A review case lists the issues planted in its documents under `expected`,
  each with a kind (`suggestion`, `question`, or `disconnect`) and the exact
  passages involved, and lists under `expectNone` the kinds that would be
  false alarms in a coherent document.

The loader rejects a case whose passages do not appear in its documents.
Tune prompts only against `tune` cases. `holdout` cases stay unseen during
prompt work, so their scores show whether a change generalizes. Write only
synthetic prose for cases, never a real manuscript. A local model may draft
long filler, as it did for the `saltworks` manuscript, but plant the issues by
hand and record that in the case's `note`.

## Scoring

The harness scores what a machine can check:

* Whether a review returns valid findings, and the share of quoted passages
  that appear in the documents
* Whether a review finds each planted issue: a finding of the right kind that
  quotes a planted passage, and for a disconnect, two of the passages that
  conflict. A case lists every passage involved in a contradiction.
* False alarms: findings of a kind the case lists in `expectNone`
* For conversation, the share of quoted passages that appear in the text

Usefulness needs judgment. A judge model scores each output from 1 to 5 on
three criteria:

| Criterion  | 5 means                                                              | 1 means                                |
|------------|----------------------------------------------------------------------|----------------------------------------|
| usefulness | Insightful, actionable ideas a serious writer would act on           | Generic or unhelpful                   |
| grounding  | Accurate about the text and anchored to the passages it cites        | Misreads or ignores the text           |
| restraint  | Respects the writer's voice; no filler, praise, or invented problems | Bloated, overreaching, or mostly noise |

The judge configuration must not be a candidate, so no model scores its own
output. Human judgment on synthetic cases is hard to differentiate from prose
a writer did not write, so offline sweeps use automatic scores and the judge
model, while human feedback is deferred to in-app comparisons on writers'
own work in [backlog 55](../docs/backlog/0055-compare-models-in-use.md).

## Results

`run`, `pair`, and `sustained` write one JSON summary per run to
[results/](./results/), named by date, configuration, and a short random
suffix. Each records the machine, the runtime and its version, the model's
digest and quantization, the digests of the prompts and cases, and per case
the timings, memory, power, thermal state, and scores. Summaries carry no
model output, only its digest. Raw output goes to `.local/evals/raw/`, which
Git ignores, so judging must run on the machine that produced the output.

Commit the summaries a decision cites. To compare a new model with an earlier
decision, run it with the same prompts and cases, which the digests confirm,
and compare the `report` tables.

## Sweeping prompt variants

A configuration in [configs.json](./configs.json) can name its prompt for
each task inside its `conversation` or `review` block (defaulting to
`conversation` and `review`), and `run` accepts `--prompt <name>` (or
`--prompt <task>=<name>`) to override it during an exploratory sweep. Every
result summary records the prompt's name and SHA-256 digest on both the
configuration block and each case item.

Follow these steps when tuning any agent's prompt:

1. Freeze the cases before running a variant. Keep `holdout` cases unseen
   while iterating, and write any new holdout cases before reading any
   variant's output.
2. Keep the current prompt as the baseline, add candidate `.txt` templates
   under [prompts/](./prompts/) with a `[system]` and `[user]` section, and
   record the reason for each variant.
3. Sweep the baseline and every candidate on `--split tune` across the
   chosen model and at least two closest challengers, writing exploratory
   summaries under `.local/evals/` so losing variants stay out of Git:

   ```bash
   cd evals
   for prompt in conversation conversation-concise conversation-grounded; do
     python3 -m writer_evals --results-dir ../.local/evals/sweep-tune \
       run gemma4-31b-mlx muse-glimmer-30b-mlx qwen3.8-27b-mlx \
       --task conversation --split tune --prompt "$prompt"
   done
   python3 -m writer_evals judge judge-qwen3.8-flash-next ../.local/evals/sweep-tune/*.json
   python3 -m writer_evals report --split tune ../.local/evals/sweep-tune/*.json
   ```

4. Rank the variants on `tune` using automatic scores (quote grounding,
   valid findings, TTFT, and tokens per reply) and judge scores. Stop
   variants that do not beat the baseline on a model, and copy only the
   baseline and finalist `tune` summaries into [results/](./results/).
5. Run the baselines and finalists once on `--split holdout`, judge them,
   and report `--split tune` and `--split holdout` separately:

   ```bash
   cd evals
   python3 -m writer_evals run gemma4-31b-mlx --task conversation --split holdout --prompt conversation-grounded
   python3 -m writer_evals judge judge-qwen3.8-flash-next results/2026-11-26-*.json
   python3 -m writer_evals report --split tune results/2026-11-25-*.json results/2026-11-26-*.json
   python3 -m writer_evals report --split holdout results/2026-11-26-*.json
   ```

6. Choose the prompt from the holdout judge scores, automatic grounding, and
   latency/token budgets, commit the chosen and finalist prompts plus the
   baseline and finalist summaries, and remove losing prompt templates.

## Tests

```bash
cd evals
python3 -m unittest discover --start-directory tests --top-level-directory .
```

The tests use a fake runtime and a local fake of Ollama's HTTP API, so they
need no model, and `tools/check` runs them in its `evals` phase.
