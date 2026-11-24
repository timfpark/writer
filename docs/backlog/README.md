---
title: Backlog
description: Prioritized index of planned work for the Writer service and clients
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
keywords:
  - backlog
  - service
  - webapp
estimated_reading_time: 2
---

## Managing the backlog

Every subsystem shares one backlog of delivery stories and open decisions.

* Keep this index sparse. Give each work item one row with a short outcome
  and its prerequisite items. Put scope, rationale, context, and links to
  decisions in the work-item document, never in this file.
* Row order is delivery priority. Independent items can proceed in
  parallel. An item already under way starts its outcome with "In
  progress:". A blocked item starts it with "Blocked:" and sits below the
  ready work.
* Prioritize defects, missing results, and misleading behavior in delivered
  views, together with their prerequisites, before new capabilities.
* Item numbers are stable identities. Give a new item the next unused number.
* A work item's `subsystems` frontmatter lists the folders it changes or the
  decision it governs (`service`, `webapp`, `evals`, or `repository` for
  repository-wide tooling and process), and the Subsystems column repeats that
  list.
* When a work item is finished, delete its row and its document, update the
  prerequisites of the items that waited on it, and reorder the backlog.

## Backlog

| #  | Work item                                                                                    | Subsystems                       | Outcome                                                                                      | Prerequisite |
|----|----------------------------------------------------------------------------------------------|----------------------------------|----------------------------------------------------------------------------------------------|--------------|
| 39 | [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)                        | `repository`, `service`, `evals` | In progress: ADR 0010 is proposed; blind scoring and a battery run remain.                   | None         |
| 47 | [Record the background tasks UX ADR](./0047-background-tasks-ux-adr.md)                      | `service`, `webapp`              | An accepted ADR picks the background agents, their UX, and how the tree scopes them.         | 39           |
| 48 | [Measure the background tasks with the evaluation harness](./0048-background-task-evals.md)  | `evals`                          | Each chosen background task is measured on local models, with a story bible test.            | 47           |
| 46 | [Tune the pair-writing prompts with the evaluation harness](./0046-prompt-tuning-evals.md)   | `evals`, `service`               | Swept prompt variants pick the prompts for conversation and each kind of finding.            | 39, 48       |
| 44 | [Record the cloud model proxy ADR](./0044-cloud-model-proxy-adr.md)                          | `repository`, `evals`, `service` | An accepted ADR picks a local proxy to Azure AI Foundry with keyless auth and spending caps. | 39           |
| 45 | [Run the cloud model proxy with a first set of Foundry models](./0045-cloud-model-proxy.md)  | `repository`, `evals`            | The proxy runs with cheap and frontier Foundry models, and the harness calls it.             | 44           |
| 43 | [Measure cloud models for pair writing](./0043-cloud-model-evals.md)                         | `evals`                          | Cheap and frontier cloud models are measured beside local ones for quality and price.        | 39, 45       |
| 38 | [Record the pair-writing experience ADR](./0038-pair-writing-experience-adr.md)              | `service`, `webapp`              | An accepted ADR fixes the writer's experience of the agent, tested end to end.               | 39, 46, 47   |
| 10 | [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)           | `service`, `webapp`              | An accepted ADR fixes where the agent runs and how it is built.                              | 38, 39       |
| 37 | [Record the agent conversations ADR](./0037-agent-conversations-adr.md)                      | `service`, `webapp`              | An accepted ADR fixes how conversations are stored, versioned, and audited.                  | 38           |
| 12 | [Answer the writer in conversation from the service](./0012-first-pair-writing-agent.md)     | `service`                        | The service answers the writer about the open document, backed by prompts and evals.         | 10, 37       |
| 34 | [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)              | `webapp`                         | The assistant pane streams the pair writer's answers about the open document.                | 12           |
| 35 | [Review documents in the background in the service](./0035-service-background-review.md)     | `service`                        | The service returns suggestions, questions, and disconnects anchored to passages.            | 12           |
| 36 | [Show background findings in the webapp](./0036-background-findings-view.md)                 | `webapp`                         | Findings appear beside the text while writing, linked to their passages.                     | 34, 35       |
| 54 | [Turn background agents on and off across the workspace tree](./0054-agent-settings-tree.md) | `service`, `webapp`              | Folders and documents set which agents run, inherited down the tree.                         | 35, 36       |
| 49 | [Keep a story bible and check continuity](./0049-story-bible-continuity.md)                  | `service`, `webapp`              | A story bible and timeline stay current, and contradictions are flagged against them.        | 35, 36, 54   |
| 50 | [Track open threads and keep a reverse outline](./0050-threads-and-outline.md)               | `service`, `webapp`              | Writers see what each scene does and which setups have no payoff.                            | 49           |
| 51 | [Review finished chapters](./0051-chapter-review.md)                                         | `service`, `webapp`              | Settled chapters get pacing, voice, reader, and anachronism reviews.                         | 35, 36, 54   |
| 53 | [Check the writer's own rules](./0053-writer-rules.md)                                       | `service`, `webapp`              | Writers set style rules, and background review flags text that breaks them.                  | 35, 36, 54   |
| 52 | [Recap the last session when Writer opens](./0052-session-recap.md)                          | `service`, `webapp`              | Returning writers see where they left off and a suggested next step.                         | 34, 54       |
| 40 | [Record the cloud model fallback ADR](./0040-cloud-model-fallback-adr.md)                    | `service`, `webapp`              | An accepted ADR decides whether and where a cloud model backs up the local one.              | 34, 36, 43   |
| 27 | [Record the change control ADR](./0027-change-control-adr.md)                                | `service`, `webapp`              | An accepted ADR fixes the commit model, commit timing, restore, and progress measures.       | None         |
| 28 | [Build the SQLite backend and copy command](./0028-sqlite-backend.md)                        | `service`                        | The workspace persists in SQLite and copies between backends intact.                         | None         |
| 29 | [Record and restore commits in the service](./0029-service-history.md)                       | `service`                        | The contract records commits, reads earlier versions, and restores them.                     | 27           |
| 30 | [Browse, compare, and restore history in the webapp](./0030-history-view.md)                 | `webapp`                         | Writers commit, browse history, compare versions, and roll back.                             | 29           |
| 31 | [Show writing progress over time](./0031-writing-progress.md)                                | `service`, `webapp`              | Writers see words added and removed per document and folder over time.                       | 29, 30       |
| 41 | [Set the language of a document](./0041-document-language.md)                                | `service`, `webapp`              | Writers pick each document's language, stored in the workspace and set on the editor.        | None         |
| 42 | [Measure the pair writer in Spanish](./0042-spanish-pair-writing-evals.md)                   | `evals`, `service`               | Spanish cases measure the local models, and the model ADR names Spanish models.              | 39, 41       |

[ADR 0002](../adrs/0002-service-architecture.md),
[ADR 0003](../adrs/0003-webapp-architecture.md), and
[ADR 0004](../adrs/0004-api-conventions.md) record the service and webapp
architecture and the API conventions. The service foundation (item 6) and the
webapp foundation (item 7) built `service/` and `webapp/` on them, applying
the [Adding a subsystem](../adrs/0001-monorepo-structure.md#adding-a-subsystem)
checklist in ADR 0001.

Items 20 through 26 complete the first release, the writing workspace the
[README](../../README.md#product-direction) describes.
[ADR 0005](../adrs/0005-workspace-model.md) fixes its workspace model and API,
[ADR 0006](../adrs/0006-storage-architecture.md) the storage that persists
it, [ADR 0007](../adrs/0007-webapp-interface.md) the webapp's interface
foundation, and [ADR 0008](../adrs/0008-editor.md) the editor and the
Markdown it reads and writes.
Item 18, the workspace storage story, built the service's
[writer-domain](../../service/crates/writer-domain/) and
[writer-storage](../../service/crates/writer-storage/) crates, which keep the
workspace as directories and Markdown files, and item 19 served them
through the workspace API in [openapi.json](../../service/openapi.json).
Item 20 built the webapp's workspace shell on ADR 0007's foundation, and
item 21 added the browser tests that drive it, as
[ADR 0009](../adrs/0009-browser-tests.md) decides. Item 22 built the
keyboard-navigable navigator, and item 23 built the writing surface with
autosave, which together make the first usable release. Item 24 added drag
and drop with move commands in each row's menu, and item 25 filled the
assistant pane with a conversation answered by a stub, and item 33 fixed
what first use of the writing surface exposed: `Enter` now breaks a line
without a gap, and the markers of formatted text show at the caret. Item 26
completed it with the navigator's remaining shortcuts, `F6` between the
panes, a shortcut reference, and keyboard-only browser tests.

The pair-writing agent follows the workspace. It answers the writer in the
assistant pane and reviews their text in the background, offering suggestions,
questions, and disconnects between passages. Item 39 first measures which
local models served by Ollama can do this on a high-end laptop, with no cloud
model, and creates the top-level `evals/` subsystem whose committed harness,
cases, and results let later models be scored against the same baseline. Cloud
models are hosted in Azure AI Foundry and reached only through a local proxy
that holds the credentials and caps spending: item 44 chooses it, and item 45
runs it with a first set of models. Item 43 then measures inexpensive and
frontier cloud models through it on the same synthetic cases, so the quality
gap and its price are known; no writer's text leaves the machine. Item 47 then
decides which agents the pair writer runs in the background, from a story
bible and continuity checks to prose, structure, nonfiction checks, and
session recaps, how each appears, and how the workspace tree scopes them, and
item 48 measures whether local models can do each. Item 46 then sweeps prompt
variants across the leading models, including a separate pass for disconnects,
so the prompts are measured rather than written once. Item 38 then decides the
experience end to end, tested with a throwaway prototype and grounded in those
results, so the decisions that follow serve it. Item 10 then decides where the
agent runs and how it is built, and item 37 decides how its conversations are
stored, tied to versions of the text, and audited. Item 12 creates
`service/prompts/` and the conversation endpoint, with its cases in `evals/`.
Item 34 connects the assistant pane to that endpoint, so writers can use the
agent for the first time. Item 35 adds background review to the service, and
item 36 shows its findings beside the text. Item 54 lets writers turn each
agent on or off for a folder or document, inherited down the tree, so a novel
and a technical book in one workspace get different agents. Items 49 to 53 add
the remaining background tasks on that plumbing: the story bible and
continuity checks, open threads and a reverse outline, chapter reviews, the
writer's own rules, and a session recap. Only after writers have used the
local pair writer does item 40 decide, from item 43's measurements and the
gaps writers felt, whether a cloud model should stand in where local models
fall short, and how writers consent before their text leaves the machine.

Change control, the later release the
[README](../../README.md#product-direction) promises, follows. Item 27
decides the history model that [ADR 0005](../adrs/0005-workspace-model.md#attaching-version-history-later)
and [ADR 0006](../adrs/0006-storage-architecture.md#committed-revisions-later)
leave room for, including whether every backend shares one history format.
Item 28 builds the SQLite backend that ADR 0006 plans; if item 27 chooses one
format, item 28 precedes item 29. The service records and restores commits
(29), the webapp browses, compares, and restores them (30), and progress
views measure what changed over time (31).

Writing in Spanish follows. Item 41 stores each document's language in the
workspace, adds a picker, and marks the writing surface so spellcheck and
hyphenation follow it. Item 42 then measures the local models on Spanish
cases with the `evals/` harness, scored by a fluent reader, so the pair
writer answers Spanish documents on a model chosen for them. Translating
Writer's own interface is not yet planned.
