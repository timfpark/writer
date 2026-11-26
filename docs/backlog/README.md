---
title: Backlog
description: Prioritized index of planned work for the Writer service and clients
author: Tim Park
ms.date: 2026-11-25
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

| #  | Work item                                                                                     | Subsystems                       | Outcome                                                                                      | Prerequisite       |
|----|-----------------------------------------------------------------------------------------------|----------------------------------|----------------------------------------------------------------------------------------------|--------------------|
| 46 | [Tune the conversation prompt with the evaluation harness](./0046-prompt-tuning-evals.md)     | `evals`                          | Swept variants pick the conversation prompt, and the harness can sweep any prompt.           | None               |
| 56 | [Test story notes for continuity checking](./0056-story-notes-continuity-test.md)             | `evals`                          | Local models are measured on checking continuity against extracted story notes.              | None               |
| 44 | [Record the cloud model proxy ADR](./0044-cloud-model-proxy-adr.md)                           | `repository`, `evals`, `service` | An accepted ADR picks a local proxy to Azure AI Foundry with keyless auth and spending caps. | None               |
| 45 | [Run the cloud model proxy with a first set of Foundry models](./0045-cloud-model-proxy.md)   | `repository`, `evals`            | The proxy runs with cheap and frontier Foundry models, and the harness calls it.             | 44                 |
| 38 | [Record the pair-writing experience ADR](./0038-pair-writing-experience-adr.md)               | `service`, `webapp`              | An accepted ADR fixes the writer's experience of the agent, tested end to end.               | 46                 |
| 10 | [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)            | `service`, `webapp`              | An accepted ADR fixes where the agent runs, how agents chain, and how it is built.           | 38, 56             |
| 37 | [Record the agent conversations ADR](./0037-agent-conversations-adr.md)                       | `service`, `webapp`              | An accepted ADR fixes how conversations and living artifacts are stored and audited.         | 10, 38             |
| 12 | [Answer the writer in conversation from the service](./0012-first-pair-writing-agent.md)      | `service`                        | The service answers the writer about the open document, backed by prompts and evals.         | 10, 37, 46         |
| 34 | [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)               | `webapp`                         | The assistant pane streams the pair writer's answers about the open document.                | 12                 |
| 57 | [Choose the model for each mode in settings](./0057-model-settings.md)                        | `service`, `webapp`              | Writers switch the model behind each mode at run time from the models Ollama has pulled.     | 34                 |
| 48 | [Measure the background agents with the evaluation harness](./0048-background-agent-evals.md) | `evals`                          | Each first-wave background agent is measured on local models with a first prompt.            | 56                 |
| 35 | [Review documents in the background in the service](./0035-service-background-review.md)      | `service`, `evals`               | The service returns the first background agents' findings, with tuned prompts.               | 12, 48             |
| 36 | [Show background findings in the webapp](./0036-background-findings-view.md)                  | `webapp`                         | Findings appear beside the text while writing, linked to their passages.                     | 34, 35             |
| 59 | [Measure battery drain and host typing during review](./0059-battery-and-typing-check.md)     | `evals`, `webapp`                | ADR 0010 records unplugged battery drain and host-browser typing during review.              | None               |
| 49 | [Keep story notes and check continuity](./0049-story-notes-continuity.md)                     | `service`, `webapp`, `evals`     | Story notes and a timeline stay current, and contradictions are flagged against them.        | 35, 36             |
| 50 | [Track open threads and keep a reverse outline](./0050-threads-and-outline.md)                | `service`, `webapp`, `evals`     | Writers see what each scene does and which setups have no payoff.                            | 49                 |
| 51 | [Review finished chapters](./0051-chapter-review.md)                                          | `service`, `webapp`, `evals`     | Settled chapters get pacing, voice, and first-reader reviews from story notes and outline.   | 49, 50             |
| 53 | [Check the writer's own rules](./0053-writer-rules.md)                                        | `service`, `webapp`, `evals`     | Writers set style rules, and background review flags text that breaks them.                  | 35, 36             |
| 52 | [Recap the last session when Writer opens](./0052-session-recap.md)                           | `service`, `webapp`, `evals`     | Returning writers get workspace, folder, and document recaps with a suggested next step.     | 34, 35             |
| 54 | [Turn background agents on and off across the workspace tree](./0054-agent-settings-tree.md)  | `service`, `webapp`              | Writers turn agents on or off for folders and documents, inherited down the tree.            | 49, 50, 51, 52, 53 |
| 58 | [Check technical nonfiction](./0058-nonfiction-agents.md)                                     | `service`, `webapp`, `evals`     | Technical books get terminology, concept order, code, and cross-reference checks.            | 54                 |
| 55 | [Compare models while writing](./0055-compare-models-in-use.md)                               | `service`, `webapp`, `evals`     | Writers trial new models side by side on their own work and adopt the better one.            | 36, 57             |
| 43 | [Measure cloud models for pair writing](./0043-cloud-model-evals.md)                          | `evals`                          | Cheap and frontier cloud models are measured beside local ones for quality and price.        | 35, 45             |
| 40 | [Record the cloud model fallback ADR](./0040-cloud-model-fallback-adr.md)                     | `service`, `webapp`              | An accepted ADR decides whether and where a cloud model backs up the local one.              | 34, 36, 43         |
| 27 | [Record the change control ADR](./0027-change-control-adr.md)                                 | `service`, `webapp`              | An accepted ADR fixes the commit model, commit timing, restore, and progress measures.       | None               |
| 28 | [Build the SQLite backend and copy command](./0028-sqlite-backend.md)                         | `service`                        | The workspace persists in SQLite and copies between backends intact.                         | None               |
| 29 | [Record and restore commits in the service](./0029-service-history.md)                        | `service`                        | The contract records commits, reads earlier versions, and restores them.                     | 27                 |
| 30 | [Browse, compare, and restore history in the webapp](./0030-history-view.md)                  | `webapp`                         | Writers commit, browse history, compare versions, and roll back.                             | 29                 |
| 31 | [Show writing progress over time](./0031-writing-progress.md)                                 | `service`, `webapp`              | Writers see words added and removed per document and folder over time.                       | 29, 30             |
| 42 | [Measure the pair writer in Spanish](./0042-spanish-pair-writing-evals.md)                    | `evals`, `service`               | Spanish cases measure the local models, and the model ADR names Spanish models.              | None               |

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
assistant pane and runs background agents that review their text and keep
reference material current. Item 39 measured which local models served by
Ollama can do this on a high-end laptop, with no cloud model, and created the
top-level `evals/` subsystem;
[ADR 0010](../adrs/0010-pair-writing-models.md) records the models it chose
and the gaps it found, chiefly disconnects across passages.

[ADR 0011](../adrs/0011-background-agents-ux.md) (item 47) picks the
fifteen fiction-first background agents for Wave 1, their shapes, triggers,
always-on subtle passage underlines with density caps, the three-tab
assistant pane (`Findings`, `Reference` with full-width Expand, and
`Chat`), recursive session recaps at any tree depth, global Pause, and OS power-state
battery policy, deferring anachronisms and the nonfiction agents.

Next, items 46, 56, and 44 run in parallel. Item 46 tunes the conversation
prompt and teaches the harness to sweep prompts. Item 56 tests whether
checking continuity against story notes, extracted chapter by chapter,
closes the disconnect gap, because the answer shapes the agent's
architecture. Cloud models are hosted in Azure AI Foundry and reached only
through a local proxy that holds the credentials and caps spending: item 44
chooses it, and item 45 runs it with a first set of models, which items 56
and 48 use as a ceiling for local results.

Item 38 then designs the writer's journeys around ADR 0011's agents,
extending its prototype with conversation. Item 10 decides where the agent
runs, how agents chain, and how it is built, and item 37 decides how
conversations and living artifacts are stored, tied to versions of the text,
and audited. Item 12 creates `service/prompts/` and the conversation
endpoint, and item 34 connects the assistant pane to it, so writers use the
agent for the first time. Item 57 lets them switch the model behind each
mode.

Background review follows. Item 48 measures each first-wave agent with a
first prompt. Item 35 tunes the first agents' prompts and adds background
review to the service, and item 36 shows its findings beside the text. Item
59 runs the unplugged battery and host-browser typing check ADR 0010 left
open without blocking the first agents, so battery targets can be adjusted
before the full set runs. Items 49 to 53 add the remaining agents on that
plumbing, each tuning its own prompts: story notes and continuity checks,
open threads and a reverse outline, chapter reviews, the writer's own rules,
and a session recap. Item 54 then lets writers turn each agent on or off for
a folder or document, inherited down the tree, and item 58 adds the
nonfiction agents a technical book needs. Item 55 trials candidate models
side by side in real use.

Only after writers have used the local pair writer does item 43 measure
inexpensive and frontier cloud models on the prompts the service ships, and
item 40 decide, from those measurements and the gaps writers felt, whether a
cloud model should stand in where local models fall short, and how writers
consent before their text leaves the machine.

Change control, the later release the
[README](../../README.md#product-direction) promises, follows. Item 27
decides the history model that [ADR 0005](../adrs/0005-workspace-model.md#attaching-version-history-later)
and [ADR 0006](../adrs/0006-storage-architecture.md#committed-revisions-later)
leave room for, including whether every backend shares one history format.
Item 28 builds the SQLite backend that ADR 0006 plans; if item 27 chooses one
format, item 28 precedes item 29. The service records and restores commits
(29), the webapp browses, compares, and restores them (30), and progress
views measure what changed over time (31).

Writing in Spanish follows. Item 41 stored each document's language in the
workspace, added a picker, and marked the writing surface so spellcheck and
hyphenation follow it. Item 42 then measures the local models on Spanish
cases with the `evals/` harness, scored by a fluent reader, so the pair
writer answers Spanish documents on a model chosen for them. Translating
Writer's own interface is not yet planned.
