---
title: "ADR 0011: Background agents and their user experience"
description: Picks the fifteen fiction-first background agents that ship in Wave 1, defers anachronisms and the five nonfiction agents, fixes each shipping agent's shape, scope, trigger, surface, interruption, ranking, living-artifact trust model, work sharing, quietness gates, pause control, and battery policy, and records what a throwaway prototype changed
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
status: Accepted
subsystems:
  - service
  - webapp
keywords:
  - adr
  - background agents
  - ux
  - living artifacts
  - story notes
  - continuity
  - battery
  - pair writing
estimated_reading_time: 16
---

## Status

Accepted on 2026-11-25; amended on 2026-11-27 by
[ADR 0012](./0012-pair-writing-experience.md#pause-reviews-keep-running-while-the-writer-types-elsewhere),
which lets a pause review finish while the writer types outside the text
under review.

This record settles the background agent selection, user experience, work
sharing, quietness rules, pause control, and battery policy for the pair
writer's first wave. Its cost and battery thresholds rest on
[ADR 0010](./0010-pair-writing-models.md)'s AC power measurements and will be
revisited if [backlog 59](../backlog/0059-battery-and-typing-check.md)'s
unplugged battery and host-browser typing checks diverge materially from
those estimates. Its continuity chain waits on
[backlog 56](../backlog/0056-story-notes-continuity-test.md) and its agent
feasibility waits on
[backlog 48](../backlog/0048-background-agent-evals.md) for the five
pause-triggered agents and
[backlog 63](../backlog/0063-remaining-background-agent-evals.md) for the
rest. Per-folder and per-document agent settings follow in
[backlog 54](../backlog/0054-agent-settings-tree.md), and the deferred
nonfiction agents follow in
[backlog 58](../backlog/0058-nonfiction-agents.md).

## Decision summary

* Ship 15 fiction-first background agents in Wave 1 (candidates 1 through
  15), ranked from fast prose and question checks through living artifacts,
  chained continuity and chapter reviews, the writer's own rules, and
  tree-scoped session recaps at any depth. Every shipping agent starts on for every
  document until backlog 54 adds tree-inherited settings.
* Defer candidate 16 (anachronisms and facts) until after backlog 54 allows
  opt-in per book or [backlog 40](../backlog/0040-cloud-model-fallback-adr.md)
  adds stronger factual grounding; defer candidates 17 through 21 (the five
  nonfiction agents) to backlog 58. None of the 21 candidates is permanently
  cut; generative rewrites and synopses stay on request in conversation.
* Separate background outputs into two shapes: findings (passage-anchored
  notes the writer jumps to, discusses in chat, or dismisses) and living
  artifacts (story notes, timeline, reverse outline, open threads, chapter
  reader reaction, and the workspace's session recaps).
* Show subtle hairline passage underlines on the writing surface for
  passages with active findings whether the assistant pane is open or
  closed, never mid-keystroke and always capped per scene and chapter so
  short drafts stay calm. When the assistant pane is closed, show a quiet
  active-findings count badge (and a subtle running dot while an agent
  works) on the assistant toggle without opening the pane or moving focus.
* Organize the assistant pane into three tabs: Findings, Reference, and
  Chat. Living artifacts (story notes, timeline, reverse outline, open
  threads, and the writer's own rules) live in the Reference tab beside the
  writer's prose, scoped to the active top-level folder (book) subtree, with
  an Expand control to open wide tables and outlines full-width in the
  center region. The Reader reaction background agent surfaces its
  chapter-level findings as a collapsible card inside Findings once a
  chapter settles.
* Scope Session recap recursively across N levels: the workspace root
  aggregates recaps across all root folders, any directory at any depth
  shows only its own tree's recap, and any file shows only that file's
  recap. Returning to a file from an earlier session shows a compact
  dismissible banner that clears the moment the writer types.
* Make living artifacts trustworthy through source passage citations,
  visible provenance (`Extracted` versus `Edited by you`), inline editing
  with a plain Save button that pins the writer's value against future
  extractions, a Revert to extracted action, and immediate downstream
  re-evaluation of chained agents when a writer corrects a fact.
* Share work across agents so costs fit ADR 0010's latency and ~60 W active
  envelope: pause checks inspect only changed paragraphs or scenes, chapter
  settlement extracts compact deltas per chapter instead of rereading the
  manuscript, and downstream checks (continuity, character voice, pacing,
  and session recaps) read those living artifacts rather than the full
  manuscript.
* Keep non-applicable agents silent on mixed workspaces (such as a novel
  and a technical book in the same workspace) with two layers: zero-cost
  structural gates (word-count floors, code-block and expository-document
  detection, dialogue presence, and rule presence) and prompt-level
  restraint that treats returning empty as success.
* Give the writer a visible status line and one-click Pause control in the
  assistant pane header (`Mod+Shift+P`) that immediately cancels in-flight
  background work and stops all background triggers while keeping on-request
  Chat available. On battery, lengthen pause windows and defer chapter
  settlement to hold average extra draw low; on low battery (20% or below,
  or OS Low Power Mode), auto-pause background work with a one-click Resume
  anyway override, using OS power state reported by the local service.

## Context

[ADR 0010](./0010-pair-writing-models.md) established that local 30B models
served by Ollama on the reference laptop (Gemma 4 31B MLX for conversation
and Muse Glimmer 30B MLX for background review) can find weak passages and
open threads reliably, while failing to find contradictions reliably across
a whole manuscript. It also bounded their runtime cost: a scene review takes
about 3 to 17 seconds, a chapter review about 8 to 17 seconds, and a full
manuscript review 75 to 92 seconds, drawing about 60 W active against about
15 W idle on AC power (roughly 1.2 hours of continuous review on a 72 Wh
battery).

ADR 0010 tested only three example finding kinds (suggestions, questions,
and disconnects). Real writing help spans two distinct shapes:

* Findings: one-off notes anchored to specific passages that a writer acts
  on, discusses in chat, or dismisses.
* Living artifacts: evolving reference material the pair writer maintains
  across chapters (such as story notes, a timeline, a reverse outline, or
  a list of open threads) that the writer reads, trusts, and corrects.

A single Writer workspace can hold different kinds of work at once, such as
a novel alongside a technical book. Because tree-inherited per-agent
settings wait for [backlog 54](../backlog/0054-agent-settings-tree.md),
every Wave 1 agent starts enabled for every document and must stay quiet on
work it does not apply to.

To test these choices while actually writing rather than on paper alone, we
built a throwaway, clickable prototype outside the repository (kept in
ignored `.local/prototype/`), styled with
[ADR 0007](./0007-webapp-interface.md)'s light and dark tokens and
containing both a synthetic novel (*The Salt Lantern*, three chapters) and a
synthetic technical book (*Designing Local-First Systems*, two chapters).
Its conversation module is separated cleanly so
[ADR 0012](./0012-pair-writing-experience.md) could extend the
same prototype with conversation journeys instead of starting another.

## Decision drivers

* Calm writing first: background help must never block typing, jump the
  caret, shift the 36 em writing measure, or crowd a short page with visual
  noise.
* High signal on mixed workspaces: every always-on agent must earn its
  attention on fiction and stay silent on technical prose and short notes.
* Grounded in local hardware: scheduling and work sharing must fit ADR
  0010's latency and ~60 W active envelope without draining a laptop battery
  during an unplugged writing session.
* Trustworthy living artifacts: writers must see where every extracted fact
  came from, correct it in place, and trust that later extractions honor
  their edits and update downstream checks.
* Keyboard-operable and accessible from the start, consistent with ADR 0007
  and [ADR 0008](./0008-editor.md)'s ProseMirror decorations.

## Candidate agents

Each of the 21 candidate agents was weighed from the writer's point of view
against local 30B model capability, false-alarm risk when always on, and
Wave 1's fiction focus. Generative work (rewrites, alternate scenes,
synopses) stays on request in conversation and out of scope here.

| #  | Agent                    | Decision | Target story   | Writer-facing reason                                                                                                                                           |
|----|--------------------------|----------|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Story notes              | Ship     | Backlog 49     | Relieves the writer of manual note-keeping for characters, places, and objects, and feeds continuity checks (replaces the earlier "story bible" working name). |
| 2  | Continuity check         | Ship     | Backlog 49     | Catches high-stakes factual slips across chapters by reading story notes and the timeline; gated on backlog 56.                                                |
| 3  | Timeline                 | Ship     | Backlog 49     | Tracks days, seasons, and time of day per scene and exposes impossible sequences alongside story notes.                                                        |
| 4  | Open threads             | Ship     | Backlog 50     | Surfaces setups without payoffs so promises to the reader are not dropped; local models already spot these well.                                               |
| 5  | Reverse outline          | Ship     | Backlog 50     | Shows what each scene tries to do and what changes, helping structural revision without rereading every page.                                                  |
| 6  | Scene purpose and pacing | Ship     | Backlog 51     | Highlights scenes where nothing shifts and sagging middles, grounded in the reverse outline once settled.                                                      |
| 7  | Weak prose               | Ship     | Backlog 35, 36 | High universal value for clichés, filler, and overwriting; ADR 0010 proved local models handle this reliably.                                                  |
| 8  | Repetition               | Ship     | Backlog 35, 36 | Concrete, low-ego catch of echo words, repeated gestures, and repeated openings that writers go blind to.                                                      |
| 9  | Point of view and tense  | Ship     | Backlog 35, 36 | Mechanical slips (head-hopping, tense drift) that disrupt immersion and are painful to miss in revision.                                                       |
| 10 | Character voice          | Ship     | Backlog 51     | Flags out-of-character dialogue once a chapter settles, chained to story notes voice details to avoid noise.                                                   |
| 11 | Clarity                  | Ship     | Backlog 35, 36 | Catches ambiguous pronouns, unclear speakers, and muddled blocking without imposing a house style.                                                             |
| 12 | Reader reaction          | Ship     | Backlog 51     | Gives an immediate chapter-level beta-reader read (engagement, confusion, predictions) without waiting days.                                                   |
| 13 | Open questions           | Ship     | Backlog 35, 36 | Core pair-writer behavior: opens creative paths the draft has not taken and bridges naturally into chat.                                                       |
| 14 | Session recap            | Ship     | Backlog 52     | Cuts re-entry friction after a break by summarizing where the writer left off, what changed, and a next step.                                                  |
| 15 | The writer's own rules   | Ship     | Backlog 53     | High-trust personalized checks defined by the writer; naturally silent until the writer adds a rule.                                                           |
| 16 | Anachronisms and facts   | Defer    | After 54 / 40  | Offline 30B models hallucinate historical facts and misfire on fantasy or sci-fi worldbuilding when always on.                                                 |
| 17 | Terminology              | Defer    | Backlog 58     | Technical nonfiction check; waits for tree settings (backlog 54) so novels never run it.                                                                       |
| 18 | Concept order            | Defer    | Backlog 58     | Technical nonfiction check; waits for tree settings (backlog 54) and living-artifact plumbing from Wave 1.                                                     |
| 19 | Code and examples        | Defer    | Backlog 58     | Technical nonfiction check; waits for tree settings (backlog 54) and code-block passage anchors.                                                               |
| 20 | Technical accuracy       | Defer    | Backlog 58     | Technical nonfiction check; needs opt-in scoping and question-phrased uncertainty to avoid false corrections.                                                  |
| 21 | Cross-references         | Defer    | Backlog 58     | Technical nonfiction check; waits for tree settings (backlog 54) and heading or figure reference tracking.                                                     |

No candidate is permanently cut. Candidate 16 (anachronisms and facts) has
real value for historical fiction once writers can turn it on for a specific
book folder (backlog 54) and optionally back it with stronger factual
grounding or cloud fallback (backlog 40), with findings phrased strictly as
questions to verify. Candidates 17 through 21 wait for
[backlog 58](../backlog/0058-nonfiction-agents.md).

### What deferred nonfiction agents need from Wave 1

To avoid reworking plumbing when backlog 58 adds candidates 17 through 21,
Wave 1 leaves four seams ready for them:

* Generalized living-artifact storage and correction UX: Terminology (17)
  and Concept order (18) reuse the same book-scoped artifact store, source
  citations, `Edited by you` provenance, and `Revert to extracted` actions
  built for Story notes and Timeline.
* Passage anchoring across prose, headings, and fenced code blocks: Code
  and examples (19) and Cross-references (21) need ADR 0008's decoration
  anchors to address headings and code blocks cleanly, not only body
  paragraphs.
* Question-phrased finding convention: Technical accuracy (20) and later
  Anachronisms (16) reuse the tentative question tone established for Open
  questions (13) so uncertain factual checks never present model guesses as
  authoritative corrections.
* Tree-inherited agent settings and presets: backlog 54 turns fiction and
  nonfiction bundles on per folder so technical checks never fire on a
  novel and fiction checks no longer rely on quietness gates on a technical
  book.

## Shipping agents: design and ranking

The 15 shipping agents are ranked by value to the writer, balancing daily
usefulness, local-model reliability from ADR 0010, and structural
dependencies so [backlog 48](../backlog/0048-background-agent-evals.md),
[backlog 63](../backlog/0063-remaining-background-agent-evals.md), and the delivery stories build them in
order.

| Rank | #  | Agent                    | Shape           | Scope                    | Trigger                         | Surface                                            | Interruption                                    |
|------|----|--------------------------|-----------------|--------------------------|---------------------------------|----------------------------------------------------|-------------------------------------------------|
| 1    | 7  | Weak prose               | Finding         | Paragraph or scene       | Short typing pause              | Hairline underline + Findings tab                  | None while typing; quiet mark after pause       |
| 2    | 11 | Clarity                  | Finding         | Paragraph or scene       | Short typing pause              | Hairline underline + Findings tab                  | None while typing; quiet mark after pause       |
| 3    | 13 | Open questions           | Finding         | Scene                    | Short typing pause              | Dotted underline + Findings tab (Answer in Chat)   | None while typing; quiet mark after pause       |
| 4    | 9  | Point of view and tense  | Finding         | Scene                    | Short typing pause              | Hairline underline + Findings tab                  | None while typing; quiet mark after pause       |
| 5    | 8  | Repetition               | Finding         | Scene                    | Short typing pause              | Hairline underline + Findings tab                  | None while typing; quiet mark after pause       |
| 6    | 1  | Story notes              | Living artifact | Chapter to book          | Chapter settled                 | Reference tab (+ Expand full view)                 | Silent update; never interrupts the page        |
| 7    | 2  | Continuity check         | Finding         | Chapter vs. artifacts    | Chained after Story notes       | Terracotta hairline underline + Findings tab       | Quiet mark + cross-chapter link once settled    |
| 8    | 3  | Timeline                 | Living artifact | Chapter to book          | Chapter settled                 | Reference tab (+ Expand) + sequence findings       | Silent update; impossible sequence adds finding |
| 9    | 4  | Open threads             | Living artifact | Chapter to book          | Chapter settled                 | Reference tab (+ Expand full view)                 | Silent update; never interrupts the page        |
| 10   | 5  | Reverse outline          | Living artifact | Chapter to book          | Chapter settled                 | Reference tab (+ Expand full view)                 | Silent update; never interrupts the page        |
| 11   | 6  | Scene purpose and pacing | Finding         | Chapter (uses outline)   | Chapter settled                 | Hairline underline + Findings tab                  | Quiet mark after chapter settles                |
| 12   | 15 | The writer's own rules   | Finding         | Document                 | Short pause or rule edit        | Dashed underline + Findings tab; rules in Ref.     | Quiet mark after pause; silent if no rules      |
| 13   | 12 | Reader reaction          | Living artifact | Chapter                  | Chapter settled                 | Collapsible chapter card inside Findings tab       | Silent card; no inline underlines on the page   |
| 14   | 10 | Character voice          | Finding         | Chapter (uses notes)     | Chapter settled                 | Hairline underline + Findings tab                  | Quiet mark after chapter settles                |
| 15   | 14 | Session recap            | Living artifact | Workspace / folder / doc | Background idle; shown on entry | Workspace view, folder view, or dismissible banner | Non-modal; clears the instant the writer types  |

### Triggers defined

* Short typing pause: begins only after typing stops for a quiet window
  (about 2.5 to 3 seconds on AC power, stretched to 10 to 15 seconds on
  battery) and only for paragraphs or scenes whose content hash changed
  since the last review. A keystroke cancels an in-flight pause review only
  when it changes the text under review; any other review finishes and holds
  its decorations until the next pause, so none touch the editor while the
  writer types, as ADR 0012 amended.
* Chapter settled: fires once a document meets the chapter minimum length
  and editing stops at a natural boundary: navigating away to another
  document, remaining idle for 5 minutes after substantive edits on AC, or
  finishing a session. It never fires on a 3-second mid-sentence pause.
* Background idle for Session recap: prepared once a session winds down
  (after extended idle or on clean shutdown) so opening Writer, clicking a
  folder, or returning to a document displays the recap with zero waiting
  time.

## Surfaces and interruption model

Writer's shell from [ADR 0007](./0007-webapp-interface.md) has three
regions: the collapsible left Navigator, the centered 36 em writing page,
and the collapsible right Assistant pane. Background agents fit inside that
shell without adding a fourth pane or margin cards that disturb the page
measure.

### Passage underlines and the collapsed badge

* Every passage with an active finding receives a subtle hairline
  ProseMirror decoration ([ADR 0008](./0008-editor.md)) on the writing
  surface whether the Assistant pane is open or closed. Underlines never
  appear while the writer is actively typing; they settle gently after a
  review finishes, preserving the caret position.
* Line style and muted semantic color tokens distinguish finding families
  without harsh red squiggles: solid neutral hairline for prose and chapter
  craft (`Weak prose`, `Clarity`, `Repetition`, `Point of view and tense`,
  `Scene purpose and pacing`, `Character voice`), dotted accent hairline
  for `Open questions`, dashed warm hairline for `The writer's own rules`,
  and muted terracotta hairline for `Continuity check`.
* Clicking or activating an underlined passage opens the Assistant pane (if
  closed) to the Findings tab and highlights that finding. Selecting a
  finding in the pane scrolls to and highlights its passage in the editor.
* When the Assistant pane is closed, the Assistant toggle button in the
  header shows a quiet count badge for active findings in the open document
  and a subtle pulsing dot while an agent is running. Neither opens the
  pane nor moves keyboard focus.
* Density cap: to prevent short drafts from turning into a wall of
  underlines, background review caps simultaneous active findings (target
  at most 3 pause-triggered findings per scene and at most 6 findings per
  chapter overall, keeping the highest-confidence items and never stacking
  overlapping underlines on the same span). Dismissing or fixing a finding
  frees budget on the next pass.

### Assistant pane tabs and full-width Reference view

The Assistant pane holds three tabs:

* Findings: lists active findings for the open document in reading order,
  with lightweight category filters (`All`, `Prose`, `Continuity`,
  `Questions`, `Chapter`, `Rules`), quoted passage snippets, cross-chapter
  comparison links for continuity findings, `Discuss in Chat` (or `Answer
  in Chat` for open questions) to hand off directly into conversation, and
  `Dismiss`. Once a chapter settles, `Reader reaction` appears as a
  collapsed chapter-level card above the line findings so it never clutters
  the page with underlines.
* Reference: holds `Story notes`, `Timeline`, `Outline` (Reverse outline),
  `Threads` (Open threads), and `Rules` (The writer's own rules) beside the
  writing surface so a writer can check a character detail or add a rule
  without losing sight of the sentence they are drafting. Entries are
  scoped to the active top-level folder (book) subtree, with a workspace
  overview when no document is open. An Expand control opens the active
  reference artifact full-width in the center region for wide tables and
  outlines, with a `Back to document` button and `Escape` shortcut
  returning directly to the open document.
* Chat: holds on-request conversation with the pair writer, decided in
  [ADR 0012](./0012-pair-writing-experience.md). Chat
  accepts finding handoffs and stays available even while background agents
  are paused or auto-paused on low battery.

### Recursive Session recap at any depth

Returning writers do not always return to the same scope, especially when a
workspace holds more than one book or nests parts, chapters, and scenes
inside directories. Session recap follows the selected node across N
levels, not a fixed workspace / book / chapter hierarchy:

* Workspace root (opening Writer with no document loaded): shows a calm
  workspace recap across all root folders and their descendants, grouped
  by root folder, with one-click links back to where the writer left off.
  Documents directly under the workspace root appear here too.
* Directory selection at any depth: clicking any directory in the navigator
  shows the latest activity, recent changes, and suggested next steps for
  that directory's entire tree, including files directly inside it and
  all nested directories. Selecting a child directory narrows the recap to
  that child's tree, repeatedly for as many levels as the workspace has.
  Parent and sibling activity never leaks into the selected tree's recap.
* File selection: a file recap concerns only that file, not its parent tree
  or neighboring files. Opening a document that has not been visited
  since an earlier session (never on rapid document switching within the
  same session) shows a compact, non-modal recap banner above the writing
  surface summarizing what changed last time and a suggested next step. It
  can be dismissed explicitly and clears automatically the instant the
  writer starts typing.

Directory recaps roll up prepared descendant activity without counting
the same file twice; the workspace rolls up the root trees. A changed file
refreshes its recap and the rollups along its ancestor chain, not unrelated
trees. Recaps reuse session metadata and available living artifacts
without requiring fiction-specific artifacts for technical prose or notes.
A tree with no previous session activity says so rather than borrowing
another tree's recap. Navigation never starts a blocking model call.

## Living artifacts: reading, correcting, and trust

Living artifacts earn a writer's trust only when they stay inspectable,
correctable, and obedient to the writer's intent:

* Passage provenance: every extracted entry in Story notes, Timeline,
  Reverse outline, and Open threads links directly to the source passage(s)
  it was drawn from. Clicking a citation navigates to that document and
  scrolls to the passage.
* Clear ownership badges: each fact displays whether it is `Extracted`
  (agent-managed), `Edited by you` (writer-authored override), or
  `Conflict` (two passages disagree and need reconciliation).
* Plain Save and reversible overrides: correcting an entry inline uses a
  plain `Save` button. Saving records the writer's value as authoritative so
  later extractions preserve it instead of overwriting it, while keeping
  the field freely editable by the writer. A `Revert to extracted` action
  hands the fact back to automatic extraction at any time.
* Deletion and intentional state: deleting an extracted entry suppresses
  re-extraction of the same fact unless the underlying passage changes
  materially. In Open threads, `Mark intentionally open` records a thread
  as deliberate so it stops nudging without being deleted from the list.
* Immediate downstream propagation: saving a correction in Story notes
  or Timeline immediately updates the canonical reference read by
  Continuity check and Character voice and re-evaluates affected findings.
  For example, changing a brass lantern from green glass to blue glass in
  Story notes clears the Chapter 2 flag and flags Chapter 1 instead so
  the writer can reconcile the earlier draft.

## Work sharing and chaining

Running 15 independent whole-manuscript passes on a 30B local model would
violate ADR 0010's latency (75 to 92 seconds per manuscript pass) and power
(~60 W active) bounds. Agents therefore share work in three tiers:

1. Scoped pause checks: on a short typing pause, paragraph and scene checks
   (`Weak prose`, `Clarity`, `Open questions`, `Point of view and tense`,
   `Repetition`, and `The writer's own rules`) inspect only the changed
   paragraphs and surrounding scene, skipping any block whose content hash
   was already reviewed. Backlog 48 and
   [backlog 35](../backlog/0035-service-background-review.md) measure
   whether grouping compatible prose checks or running tightly scoped
   sequential passes gives better quality per watt.
2. Incremental per-chapter extraction on settle: when a chapter settles,
   extraction reads only that changed chapter (about 8 to 17 seconds on
   ADR 0010's chosen models) to emit incremental deltas for Story notes,
   Timeline, Reverse outline, and Open threads, merged into the
   book's stored artifacts. Unchanged chapters are never re-extracted.
3. Chained downstream readers: heavier checks read compact living artifacts
   instead of rereading the whole manuscript:
   * `Continuity check` compares the changed chapter against the merged
     Story notes and Timeline (tested in backlog 56).
   * `Character voice` reads Story notes' character voice summaries
     alongside the chapter's dialogue.
   * `Scene purpose and pacing` reads the book's Reverse outline alongside
     the chapter.
   * `Session recap` summarizes recent session change metadata together
     with the Reverse outline and Open threads rather than rereading full
     chapters, then rolls up file recaps through every ancestor directory
     to the workspace root without duplicate activity.

## Staying quiet on non-applicable work

Until backlog 54 lets writers turn agents on or off per folder, every Wave
1 agent starts on for every document. Two layers keep fiction agents quiet
on a technical book, notes, or short fragments:

* Zero-cost structural gates (before any model call):
  * Word-count floors skip scene checks on tiny fragments (under 150 words)
    and chapter-settled agents on unfinished stubs (under 400 words).
  * Document-shape detection skips fiction-only agents (`Story notes`,
    `Continuity check`, `Timeline`, `Open threads`, `Reverse outline`,
    `Scene purpose and pacing`, `Point of view and tense`, `Character
    voice`, and `Reader reaction`) on documents marked by technical
    structure, such as fenced code blocks, technical tables, or expository
    section headings with no narrative dialogue.
  * `Character voice` skips any chapter with no dialogue or no character
    established across scenes in Story notes.
  * `The writer's own rules` runs zero model calls until the writer has at
    least one active rule.
* Prompt-level restraint: every agent prompt explicitly states that the
  workspace may contain technical writing, outlines, or notes, and defines
  returning an empty list (or empty artifact delta) as the correct outcome
  whenever the text does not fit the agent's purpose.
  [Backlog 48](../backlog/0048-background-agent-evals.md) and
  [backlog 63](../backlog/0063-remaining-background-agent-evals.md) score every
  shipping agent on synthetic technical nonfiction specifically to catch
  false alarms before delivery.

In addition, living artifacts scope to the active top-level folder (book)
subtree so entities extracted from a novel never bleed into a technical
book's Reference view.

## Status, pausing, and battery policy

### Visibility and Pause control

* Status line: the top bar of the Assistant pane shows a quiet, single-line
  status indicator (`Idle`, `Waiting for pause`, `Reviewing prose`,
  `Updating story notes`, `Paused by you`, or `Auto-paused on low battery`)
  and, when collapsed, a small pulsing dot on the Assistant toggle button
  while work runs. Background agents never raise modal dialogs or toasts.
* Global Pause: a one-click `Pause` / `Resume` button sits beside the
  status line in the Assistant pane header, bound to `Mod+Shift+P`.
  Pausing immediately cancels any in-flight background review or living
  artifact update, halts all background triggers across the workspace, and
  persists until the writer resumes. Pausing stops background agents only;
  on-request `Chat` remains available whenever the writer explicitly asks.
* Individual per-agent toggles wait for backlog 54 so the first wave stays
  simple while writers learn which agents help on which kinds of work.

### Battery policy

ADR 0010 measured continuous background review on AC power at about 60 W
against about 15 W idle (~45 W incremental GPU draw, or about 1.2 hours of
continuous review on a 72 Wh battery). Unplugged writing sessions need
background review to add only a few watts on average rather than running
continuously:

| Power state                                   | Pause trigger    | Chapter-settled and artifacts   | Target duty cycle | On-request Chat |
|-----------------------------------------------|------------------|---------------------------------|-------------------|-----------------|
| AC power                                      | 2.5 to 3 s pause | Normal settlement cadence       | Event-driven      | Always on       |
| On battery (above 20%, not Low Power Mode)    | 10 to 15 s pause | Deferred to extended idle or AC | At most ~10%      | Always on       |
| Low battery (20% or below, or Low Power Mode) | Auto-paused      | Auto-paused                     | 0% unless resumed | Always on       |

* At a 10% duty cycle cap on battery, a 45 W incremental burst adds roughly
  4.5 W average draw, preserving most of an unplugged writing session while
  still delivering periodic prose checks after longer pauses.
* When low-battery auto-pause engages, the status bar explains why and
  offers a one-click `Resume anyway` override for that session.
* Because Safari and WebKit do not expose the Web Battery Status API, the
  local service reads OS power state directly (AC versus battery, charge
  percentage, and OS Low Power Mode) and exposes the active power policy to
  the webapp through the API.
* [Backlog 59](../backlog/0059-battery-and-typing-check.md) replaces these
  AC-derived targets with real unplugged drain and host-browser typing
  measurements and amends this table if unplugged throttling or drain
  diverges materially.

## What the prototype showed

A throwaway, clickable prototype (kept outside git in `.local/prototype/`)
was built with Writer's light and dark tokens, a mixed workspace holding
both a synthetic novel (*The Salt Lantern*) and a synthetic technical book
(*Designing Local-First Systems*), scripted outputs for all 15 shipping
agents, live pause detectors for typing, editable living artifacts chained
to live continuity checks, a quietness log dialog, and power-state
controls. Trying it while writing surfaced four concrete design changes
incorporated into this ADR:

* Finding density cap on short drafts: on a settled ~240-word chapter with
  8 active findings, always-on hairline underlines felt visually heavy even
  with muted line tokens. This added the explicit per-scene (at most 3) and
  per-chapter (at most 6) visible finding cap and non-overlapping underline
  rule so short drafts stay calm.
* Plain Save instead of "Save & lock": labeling the Story notes inline edit
  button "Save & lock" immediately raised confusion over whether the writer
  would be locked out of editing their own entry. Changed to a plain `Save`
  button paired with an `Edited by you` badge and a `Revert to extracted`
  action.
* Recursive Session recap instead of one mixed workspace banner: testing
  the on-open recap in a workspace holding both a novel and a technical
  book mixed unrelated changes from both books into one card. Changed
  Session recap to follow the selected tree node: the workspace root
  aggregates all root folders, any directory shows its entire subtree at
  arbitrary depth, and a file shows only its own recap when returning
  after an absence.
* Responsive overlay docking and badge contrast: viewing the prototype at
  narrower widths showed that keeping both side panes docked compressed the
  writing column, and that white text on the dark-theme accent badge had
  weak contrast. Confirmed that the Assistant pane's new tabs, status bar,
  and header badge follow ADR 0007's responsive breakpoints (60 and 75 rem)
  and contrast-tested token pairs (`--color-page` text on `--color-accent`).

The prototype's `chat.js` and `workspace.js` modules stay in place outside
the repository, where
[ADR 0012](./0012-pair-writing-experience.md#what-the-prototype-showed)
extended them with the conversation journeys rather than starting another
prototype.

## Requirements on downstream ADRs and backlog

* [ADR 0012](./0012-pair-writing-experience.md) (settled): designs
  end-to-end journeys around the 15 shipping agents, the three-tab
  Assistant pane (`Findings`, `Reference`, `Chat`), always-on subtle
  underlines with density caps, the collapsed-pane badge, `Discuss in
  Chat` and `Answer in Chat` handoffs, recursive Session recap at any
  depth, global Pause and low-battery override, extending
  `.local/prototype/` rather than building a new prototype.
* [Pair-writing agent architecture ADR](../backlog/0010-agent-architecture-adr.md)
  (backlog 10): support incremental per-chapter extraction, chained agent
  execution (`Story notes` + `Timeline` feeding `Continuity check` and
  `Character voice`; `Reverse outline` feeding `Scene purpose and pacing`
  and `Session recap`), zero-cost structural quietness gates, cancellation
  when a keystroke changes the text under review (as ADR 0012 amended) or on
  Pause, OS-level power and battery state
  reporting from the local service, finding density caps, and passage
  anchors that survive edits. Roll up prepared file recaps through every
  ancestor directory to the workspace root without rereading manuscripts
  or issuing blocking model calls during navigation.
* [Agent conversations ADR](../backlog/0037-agent-conversations-adr.md)
  (backlog 37): persist book-scoped living artifacts (`Story notes`,
  `Timeline`, `Reverse outline`, `Open threads`, per-chapter `Reader
  reaction`, and `The writer's own rules`) alongside conversations, storing
  source passage citations, `Extracted` versus `Edited by you` provenance
  that survives re-extraction, `Intentionally open` thread states,
  dismissed findings keyed to unchanged text, and lightweight session
  change records supporting file recaps and directory-tree rollups at any
  depth through the workspace root.
* Delivery stories: all 15 shipping agents map cleanly to existing backlog
  stories (backlog 35 and 36 for the 5 pause-triggered prose and question
  agents, backlog 49 for Story notes, Timeline, and Continuity check,
  backlog 50 for Open threads and Reverse outline, backlog 51 for Scene
  purpose and pacing, Character voice, and Reader reaction, backlog 52 for
  Session recap, and backlog 53 for The writer's own rules). No additional
  delivery story is required; backlog 51 drops deferred anachronisms and
  now depends on backlog 49 and backlog 50 for chained artifacts, backlog
  50 moves Open threads and Reverse outline into the Reference tab with
  full-width Expand, and backlog 52 adopts recursive tree-scoped recaps.

## Consequences

### Positive

* Writers get immediate, low-noise craft help while drafting, durable
  reference artifacts without manual note-keeping, and a clear, reversible
  trust model when correcting extracted facts.
* Separating pause checks from chapter-settled extraction and chaining
  downstream checks off compact living artifacts keeps local-model latency
  and power draw within ADR 0010's envelope.
* Mixed workspaces holding fiction and technical books stay calm before
  tree settings exist, and Wave 1 lays down the exact artifact, anchor, and
  uncertainty seams backlog 58's nonfiction agents need.

### Negative

* Structural quietness gates can occasionally skip a genuinely narrative
  document that contains fenced code blocks, or let a prose-style technical
  essay trigger a fiction pass until backlog 54 adds explicit tree settings.
* Deferring Anachronisms and facts leaves historical-fiction fact checking
  out of Wave 1 until per-book opt-in and stronger factual grounding land.
* Capping visible findings per scene and chapter means some lower-priority
  prose notes wait until the writer addresses or dismisses higher-priority
  ones.

## Revisit triggers

* [Backlog 56](../backlog/0056-story-notes-continuity-test.md) finds that
  story-notes-chained continuity checks still miss contradictions or raise
  too many false alarms on local models: defer `Continuity check` behind
  cloud fallback or stronger local models.
* [Backlog 48](../backlog/0048-background-agent-evals.md) or
  [backlog 63](../backlog/0063-remaining-background-agent-evals.md) finds a shipping
  agent unreliable or noisy on synthetic technical nonfiction: defer that
  agent or tighten its structural gate before its delivery story builds it.
* [Backlog 59](../backlog/0059-battery-and-typing-check.md) finds unplugged
  battery drain or host-browser typing latency materially worse than ADR
  0010's AC estimates: tighten the battery duty cycle, pause windows, or
  auto-pause threshold.
* [Backlog 54](../backlog/0054-agent-settings-tree.md) lands tree-inherited
  settings: amend this record to retire always-on quietness heuristics
  where explicit folder presets replace them, and revisit Anachronisms (16)
  alongside [backlog 58](../backlog/0058-nonfiction-agents.md).
