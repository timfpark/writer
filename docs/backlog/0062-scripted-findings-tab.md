---
title: Try the Findings tab against scripted findings
description: Build ADR 0011's Findings tab, passage underlines, Pause, and collapsed badge, with ADR 0012's amended pause trigger, edit-versus-delete lifecycle, F8 navigation, and Chat handoffs, against scripted findings from a provisional review endpoint, so background review can be tried while writing before any background agent exists.
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
(`Mod+Shift+P`), and a quiet count badge on the collapsed toggle.
[ADR 0012](../adrs/0012-pair-writing-experience.md) adds journeys 2 to 4
and amends the trigger: a keystroke cancels a review only when it changes
the text under review, other reviews finish and hold their underlines until
the next pause, and a chat message stops review until its reply ends. An
edit inside a flagged passage drops its underline and marks its card
`Passage changed` until the next pause review replaces it, a deletion
removes the finding quietly, `F8` and `Shift+F8` move between findings, and
`Discuss in Chat` or `Answer in Chat` opens or resumes the finding's own
thread. Findings carry `What it read` disclosures, and one dot on the
collapsed toggle pulses while the pair writer works.

Backlog 60 built the agent crate, its
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
  provider, each with its agent, note, passage anchor and quoted text, and
  the facts `What it read` shows. Regenerate `service/openapi.json` and the
  webapp's client.
* Make the scripted provider find passages by deterministic rules over the
  text, such as a repeated word or an intensifier, so findings of
  ADR 0011's five pause-triggered kinds (`Weak prose`, `Clarity`, `Open
  questions`, `Point of view and tense`, and `Repetition`) appear on
  synthetic prose, paced by a configurable delay that tests shorten.
* Add a tab bar to the assistant pane with `Findings` and `Chat`, the
  `Chat` tab carrying backlog 60's dot. `Reference` joins with the first
  living artifact in [backlog 49](./0049-story-notes-continuity.md).
* Request a review after ADR 0011's quiet window on AC power, never while
  the writer types, sending only changed paragraphs or scenes. Cancel an
  in-flight review only when an edit changes its text, hold a finished
  review's underlines until the next pause, and stop review when a chat
  message is sent until its reply ends.
* Render ADR 0011's hairline underlines within its density caps as
  ProseMirror decorations, never mid-keystroke and without moving the
  caret or shifting layout, whether the pane is open or closed.
* List findings in reading order in the `Findings` tab with ADR 0011's
  category filters, a collapsed `What it read` disclosure, `Dismiss`, and
  `Discuss in Chat` or `Answer in Chat`, which opens or resumes the
  finding's thread with the finding pinned and focus in the message box.
  `Dismiss` keeps that agent's findings off the same exact text until it
  changes.
* Open the pane to a finding's card when its underline is clicked, and
  scroll to and highlight a passage when its card is selected. Make `F8`
  and `Shift+F8` move the caret to the next or previous flagged passage,
  highlight its card, and announce its agent and note, with `F6` then
  reaching the card's actions.
* Map each finding's range through the editor's transactions with
  ProseMirror's position mapping, so an edit inside the passage drops its
  underline and marks its card `Passage changed`, with only `Dismiss`,
  until the next pause review replaces it, and a deletion removes the
  finding quietly with a polite announcement.
* Add the status line and `Pause` and `Resume` (`Mod+Shift+P`) to the pane
  header, sending nothing for review while paused, leaving changed cards
  waiting, and keeping `Chat` available. List `Mod+Shift+P`, `F8`, and
  `Shift+F8` in the shortcut reference and
  [webapp/README.md](../../webapp/README.md).
* Show ADR 0011's count of active findings on the collapsed `Assistant`
  toggle, pulse backlog 60's dot while a review runs, announce a review
  that changes the count politely, never open the pane or move focus, and
  keep every action operable from the keyboard.
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
* [ ] A review that finishes while the writer types in another paragraph
  shows its underlines at the next pause, and typing in the reviewed
  paragraph cancels it, and browser tests prove both.
* [ ] Editing an underlined passage drops its underline and marks its card
  `Passage changed` until the next pause review replaces it, deleting the
  passage removes the finding quietly, and browser tests prove both.
* [ ] `F8` and `Shift+F8` reach each finding from the keyboard and announce
  its note.
* [ ] `Discuss in Chat` opens the finding's thread with the finding pinned,
  and using it again resumes that thread.
* [ ] While background work is paused, a browser test confirms no review
  request leaves the webapp and `Chat` still answers, and another confirms
  none leaves while a reply streams.
* [ ] The responsiveness tests pass with underlines shown and a review in
  flight.
* [ ] The pull request records how the provisional anchors, trigger, and
  transport behaved, for the agent architecture ADR.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
