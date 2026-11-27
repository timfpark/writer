---
title: Try the Findings tab against scripted findings
description: Build ADR 0011's Findings tab, passage underlines, Pause, and collapsed badge, with ADR 0012's edit-versus-delete lifecycle and Chat handoffs, against scripted findings from a provisional review endpoint, so background review can be tried while writing before any background agent exists.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 4
---

## Story

As the maintainer, I want the Findings tab and passage underlines running
in Writer against scripted findings so that I can feel whether always-on
background review helps or distracts while writing, and test its mechanics
end to end, before the background agents are measured, tuned, and built.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) organizes the assistant
pane into `Findings`, `Reference`, and `Chat` tabs, underlines passages
with active findings with subtle hairlines within per-scene and per-chapter
density caps, starts pause-triggered review after a quiet window and never
while keys arrive, and adds a status line, a global `Pause`
(`Mod+Shift+P`), and a quiet count badge and running dot on the collapsed
toggle. [ADR 0012](../adrs/0012-pair-writing-experience.md) adds journeys
2 to 4: mapping anchors through ProseMirror transactions, an in-place edit
drops a passage's underline and marks its card `Passage changed` with
`Recheck now` and `Dismiss`, while a deletion resolves the finding quietly,
and `Discuss in Chat` or `Answer in Chat` opens or resumes a thread
anchored to the finding. Findings carry `What it read` disclosures.

[Backlog 60](./0060-scripted-chat-tab.md) builds the agent crate, its
scripted provider, and the `Chat` tab this story hands findings to. Real
findings wait on [backlog 48](./0048-background-agent-evals.md) and
[backlog 35](./0035-service-background-review.md), and
[backlog 36](./0036-background-findings-view.md) then replaces the scripted
findings with them, keeps dismissals, and restores findings when a document
opens. The [agent architecture ADR](./0010-agent-architecture-adr.md)
decides how a finding names its passage, how reviews start, and how
findings reach the webapp. This story picks a provisional anchor, trigger,
and transport, and records how they behaved for that ADR.
[ADR 0008](../adrs/0008-editor.md) sets the editor, whose decorations must
never change the document, and
[responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) guards
typing latency.

## Scope

* Add a provisional review endpoint under
  [ADR 0004](../adrs/0004-api-conventions.md) that takes the paragraphs or
  scenes that changed and returns advice-only findings from the scripted
  provider, each with its agent, note, passage anchor, and `What it read`
  metadata. Regenerate `service/openapi.json` and the webapp's client.
* Make the scripted provider find passages by deterministic rules over the
  text, such as a repeated word or an intensifier, so findings of
  ADR 0011's five pause-triggered kinds (`Weak prose`, `Clarity`, `Open
  questions`, `Point of view and tense`, and `Repetition`) appear on
  synthetic prose, paced by a configurable delay that tests shorten.
* Add a tab bar to the assistant pane with `Findings` and `Chat`.
  `Reference` joins with the first living artifact in
  [backlog 49](./0049-story-notes-continuity.md).
* Request a review after ADR 0011's quiet window on AC power, never while
  the writer types, sending only changed paragraphs or scenes, and cancel
  an in-flight review on the next keystroke.
* Render ADR 0011's hairline underlines within its density caps as
  ProseMirror decorations, never mid-keystroke and without moving the
  caret or shifting layout, whether the pane is open or closed.
* List findings in reading order in the `Findings` tab with ADR 0011's
  category filters, a collapsed `What it read` disclosure, `Dismiss`, and
  `Discuss in Chat` or `Answer in Chat`, which opens or resumes a thread
  with a pinned finding banner and a contextual composer placeholder.
* Open the pane to a finding's card when its underline is clicked, and
  scroll to and highlight a passage when its card is selected.
* Map anchors through ProseMirror transactions so an in-place edit drops
  the underline and marks the card `Passage changed` with `Recheck now` and
  `Dismiss`, and a deletion resolves the finding quietly.
* Add the status line and `Pause` and `Resume` (`Mod+Shift+P`) to the pane
  header, sending nothing for review while paused and keeping `Chat`
  available, and list the shortcut in the shortcut reference and
  [webapp/README.md](../../webapp/README.md).
* Show the quiet count badge and running dot on the collapsed `Assistant`
  toggle, announce new findings politely, never open the pane or move
  focus, and keep every action operable from the keyboard.
* Cover each behavior with browser and accessibility tests against the real
  service running the scripted provider, and keep `responsiveness.spec.ts`
  passing with underlines shown and a review in flight.
* Leave real background agents (backlog 35 and 36), findings and
  dismissals that survive a reload, battery cadence and low-battery
  auto-pause (backlog 36), chapter-settled agents (backlog 51), and the
  `Reference` tab (backlog 49) to later stories.

## Acceptance criteria

* [ ] A writer types into a synthetic document, pauses, and sees scripted
  findings underlined within ADR 0011's caps, and continuous typing starts
  no review.
* [ ] Editing an underlined passage marks its card `Passage changed` and
  drops the underline, and deleting it resolves the finding quietly, and
  browser tests prove both.
* [ ] `Discuss in Chat` opens a thread anchored to the finding, and using
  it again resumes that thread.
* [ ] While background work is paused, a browser test confirms no review
  request leaves the webapp, and `Chat` still answers.
* [ ] The responsiveness tests pass with underlines shown and a review in
  flight.
* [ ] The pull request records how the provisional anchors, trigger, and
  transport behaved, for the agent architecture ADR.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Try the Chat tab against a scripted pair writer](./0060-scripted-chat-tab.md)
