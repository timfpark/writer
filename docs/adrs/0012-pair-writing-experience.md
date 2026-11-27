---
title: "ADR 0012: Pair-writing experience"
description: Fixes the end-to-end writer experience for conversation and background review around ADR 0011's fifteen agents, including advice-only suggestions, separate chat threads with document snapshots, default context, stale-finding behavior, collapsed-pane signaling, inspectable provenance, error states, and targets grounded in ADR 0010
author: Tim Park
ms.date: 2026-11-26
ms.topic: reference
status: Accepted
subsystems:
  - service
  - webapp
keywords:
  - adr
  - pair writing
  - ux
  - conversation
  - background review
  - latency
  - accessibility
estimated_reading_time: 18
---

## Status

Accepted on 2026-11-26.

This record settles the writer-facing experience of the pair writer in both
conversation and background review, built around the fifteen Wave 1 shipping
agents and three-tab Assistant pane chosen in
[ADR 0011](./0011-background-agents-ux.md) and grounded in the local-model
measurements of [ADR 0010](./0010-pair-writing-models.md). It resolves the
open follow-up on how suggestions are shown and accepted in
[ADR 0008](./0008-editor.md#follow-up-decisions), and sets the experience
requirements and resource targets that the
[agent architecture ADR](../backlog/0010-agent-architecture-adr.md)
(backlog 10) and the
[agent conversations ADR](../backlog/0037-agent-conversations-adr.md)
(backlog 37) must meet. Unplugged battery drain and host-browser GPU typing
checks remain with
[backlog 59](../backlog/0059-battery-and-typing-check.md), and any future
cloud fallback waits for
[backlog 40](../backlog/0040-cloud-model-fallback-adr.md).

## Decision summary

* Keep suggestions advice-only: the pair writer quotes the writer's prose
  verbatim (clickable to jump to the passage) and sketches brief italicized
  illustrative alternatives at most, matching ADR 0010's
  `conversation-grounded` prompt. Writer never offers one-click insert or
  replace into the manuscript, keeping the writer's voice, ADR 0008's undo
  history and byte-exact round trip, and compliance with Muse Glimmer's
  usage policy intact.
* Organize the `Chat` tab around separate named threads with a compact
  thread header and inline collapsible switcher drawer (`This document` /
  `All chats`), `+ New`, and inline-confirmed `Delete`. Clicking `Answer in
  Chat` or `Discuss in Chat` on a finding opens a dedicated thread anchored
  to that finding (or resumes the existing thread if one already exists).
* Ground each chat turn automatically in the open document, the active
  selection (if any), and the active book's compact living artifacts
  (`Story notes`, `Timeline`, `Reverse outline`, and `Open threads`). Other
  documents and earlier chat threads are opt-in via `+ Context`, keeping
  chat replies near ADR 0010's 2-second first-token range instead of the
  15 to 100 second whole-manuscript wait.
* Capture non-empty editor selections as a visible chip above the composer
  so focus moving into the chat box does not lose the selection, and clear
  the chip automatically when the writer edits the document or starts a new
  chat so a stale selection never silently narrows an unrelated question.
* Handle stale findings by distinguishing edits from deletions through
  ProseMirror position mapping: editing an underlined passage removes its
  underline immediately and marks the card `Passage changed` (with `Recheck
  now` and `Dismiss`) until the next pause pass resolves or replaces it;
  deleting the passage auto-resolves the finding quietly.
* Signal unread results while the Assistant pane is collapsed without
  opening the pane, showing modal toasts, or moving focus: keep ADR 0011's
  active-findings count badge and pulsing running dot (covering both
  background review and an in-flight chat stream), and add a quiet unread
  chat dot when a streamed chat reply finishes while Chat is not visible.
  Announce completions politely to assistive technology.
* Show a collapsed `What it read` disclosure on every assistant reply and
  finding card naming the exact sources, model, prompt version, latency,
  and brief grounding rationale.
* Preserve per-turn document snapshots for revived conversations: opening a
  thread whose document has since changed shows a `Document edited since
  this chat` banner with `View text then`, and every earlier turn whose
  snapshot differs from the current draft keeps a `Text then` action even
  after the writer continues the thread against the current draft.
* Keep writing, saving, and the workspace completely unaffected when no
  provider is configured, when the machine is offline (local Ollama keeps
  working), or when an agent fails (inline error card with `Retry` that
  never drops the writer's message).
* Require implementations to meet ADR 0010-grounded targets: chat first
  token within 3 seconds median on the reference machine, active chat
  yielding GPU priority over background review, pause review within 20
  seconds and cancelled on any keystroke, peak memory within each hardware
  tier (36 GB on 48 GB+ machines), ADR 0011's battery duty cycle, and zero
  regression on [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts).

## Context

The [README](../../README.md#overview) describes an AI pair writer that stays
beside the writer in two modes: on-request conversation in the Assistant
pane and unprompted background review while writing. Earlier records fixed
the pieces this experience sits on:

* [ADR 0007](./0007-webapp-interface.md) defines the three-region shell,
  light and dark semantic tokens, responsive breakpoints (60 and 75 rem),
  and keyboard navigation (`F6`, `Mod+\`, `Mod+Shift+\`).
* [ADR 0008](./0008-editor.md) defines the Tiptap/ProseMirror editor,
  byte-exact Markdown round trip, undo history, and 1 MiB responsiveness
  targets, leaving open how suggestions are shown and accepted.
* [ADR 0010](./0010-pair-writing-models.md) measured local Ollama models on
  the reference MacBook Pro (M5 Max, 128 GB), selected `gemma4:31b-mlx`
  with [conversation-grounded.txt](../../evals/prompts/conversation-grounded.txt)
  for conversation (~2 s TTFT, 98% to 100% grounded quotes, ~187 to 231
  tokens per reply) and `muse-glimmer:30b-mlx` for background review (~17 s
  per scene or chapter), quantified GPU contention when both run together
  (conversation throughput drops by half to two thirds), and bounded peak
  memory (~36 GB for the MLX pair) and AC power (~60 W active vs. ~15 W
  idle).
* [ADR 0011](./0011-background-agents-ux.md) picked the fifteen Wave 1
  fiction-first background agents, separated outputs into passage-anchored
  findings and book-scoped living artifacts, placed them in a three-tab
  Assistant pane (`Findings`, `Reference` with full-width Expand, and
  `Chat`), added always-on subtle hairline underlines with density caps,
  recursive N-level Session recaps, global `Pause` (`Mod+Shift+P`), and
  OS power-state battery policies.

Backlog 25 built a minimal in-memory conversation stub behind `Assistant` in
[conversation.ts](../../webapp/src/workspace/conversation.ts). Before
backlog 10 chooses how the agent is built and backlog 37 chooses how
conversations and snapshots are stored, this record fixes the complete
experience end to end and validates it by extending ADR 0011's throwaway
prototype in ignored `.local/prototype/`.

## Decision drivers

* Writer authorship and calm focus come first: the agent advises, questions,
  and cites the writer's prose without grabbing the keyboard, rewriting
  pages behind the writer's back, or adding chrome that crowds the 36 em
  writing measure.
* Local-first reality: text never leaves the writer's machine in Wave 1,
  offline use is normal, and latency, memory, and battery targets must fit
  ADR 0010's measured envelope rather than assuming an unbounded cloud API.
* Clear continuity across time: drafts evolve every session, so findings
  must respond gracefully to edits and deletions, and revived chats must
  let the writer inspect the prose as it stood when the agent answered.
* Inspectability builds trust: writers should always be able to check what
  the agent read and why it raised a note without cluttering the normal
  reading flow.
* Keyboard-first and accessible: every control follows ADR 0007 and ADR 0009
  with polite live-region announcements and zero focus theft.

## Core experience decisions

### Suggestions stay advice, never automatic rewrites

We weighed three options for resolving ADR 0008's open follow-up on how
suggestions are shown and accepted:

1. Advice only: findings and chat replies quote passages verbatim and offer
   brief italicized illustrative alternatives at most; the writer edits the
   manuscript directly or copies any phrase they choose.
2. Opt-in `Apply to selection` in chat for explicit rewrite requests,
   committed as a single undoable ProseMirror transaction.
3. Inline diff and one-click accept/reject on both background findings and
   chat replies.

Decision: choose option 1 (advice only).

* Voice and authorship: Writer is a tool for thinking and crafting prose,
  not an automated ghostwriter. ADR 0010's chosen `conversation-grounded`
  prompt already instructs the model to offer short illustrative
  alternatives in italics and avoid rewriting whole passages unless asked.
* Usage-policy clarity: ADR 0010 flagged that Meta's usage policy for Muse
  Glimmer asks users not to represent model output as human-generated.
  Keeping both background review and conversation strictly advisory avoids
  inserting model-authored prose into the manuscript by default.
* Editor integrity: ProseMirror decorations stay purely visual highlights
  and never mutate the document tree, keeping ADR 0008's undo stack,
  CommonMark canonical serializer, and untouched-block byte preservation
  completely free of synthetic agent transactions.
* Fast navigation replaces one-click mutation: every verbatim quote in a
  finding card or assistant reply acts as a clickable jump button that
  scrolls the open document to that passage and briefly highlights it, so
  acting on advice takes one click and natural typing.

### Separate named threads inside the Chat tab

We weighed three ways to organize conversations beside ADR 0011's `Findings`
and `Reference` tabs:

1. Separate named threads with a compact thread switcher and inline
   collapsible drawer inside the `Chat` tab (similar to coding assistants).
2. One continuous conversation per document.
3. One continuous conversation across the entire workspace.

Decision: choose option 1 (separate named threads inside `Chat`).

* Finding handoffs stay coherent: clicking `Answer in Chat` on an open
  question or `Discuss in Chat` on a continuity flag opens a focused thread
  anchored to that finding instead of tangling it into an unrelated craft
  discussion. Re-clicking the handoff on the same finding resumes that
  thread rather than creating duplicates.
* Clean lifecycle for revival and deletion: a writer can revive one past
  brainstorming thread or permanently delete a dead-end chat without
  wiping an entire document's conversation history.
* Compact footprint: the `Chat` tab header holds a single switcher button
  (showing the active thread title and thread count), a `+ New` button, and
  a `Delete` button (when viewing a saved thread) that expands an inline
  confirmation bar. Opening the switcher reveals a compact drawer inside
  the `Chat` tab with `This document` and `All chats` filters rather than
  adding a fourth sidebar or modal dialog.

### What the agent pays attention to

We weighed three default context scopes for conversation turns:

1. Open document + active selection (if any) + the active book's compact
   living artifacts (`Story notes`, `Timeline`, `Reverse outline`, and
   `Open threads`), plus explicit opt-in attachment of other documents or
   earlier chat threads through `+ Context`.
2. Open document and selection only, with everything else opt-in.
3. The entire active book folder on every chat turn.

Decision: choose option 1.

* Respects ADR 0010's latency physics: sending a full 25,000-token
  manuscript took 15 to 100 seconds before the first token in ADR 0010,
  whereas a single chapter plus compact living artifacts stays near
  `gemma4:31b-mlx`'s ~2-second TTFT while still giving cross-chapter
  awareness of characters, timeline, and open threads.
* Transparent scope: a subtle chip row directly above the composer shows
  exactly what is in scope (for example `Chapter 1 · Story notes &
  artifacts`, an optional `Selection: "…"` chip with a clear button, and
  any `+ Chapter 2` or `+ Chat: …` opt-in chips).
* Selection stays alive across focus shifts: selecting text in the editor
  captures the passage into the selection chip so clicking or tabbing into
  the chat box does not lose it; editing the document or starting a new
  chat clears the selection chip automatically so an old selection never
  silently narrows a new question.
* Earlier conversations are never injected silently: a new chat starts
  fresh unless the writer explicitly attaches an earlier thread via
  `+ Context` or continues inside that thread directly.
* On non-fiction or technical documents where ADR 0011's fiction living
  artifacts are empty or absent, the agent simply reads the open document
  (plus any selection or explicit attachments).

### Findings when a passage is edited or deleted

We weighed three behaviors when the writer modifies text beneath an active
finding:

1. Distinguish edits from deletions: editing an underlined passage drops
   its editor underline immediately and marks its card `Passage changed`
   (with `Recheck now` and `Dismiss`) until the next typing-pause review
   resolves or replaces it; deleting the passage auto-resolves the finding
   quietly (removing both underline and card).
2. Clear both underline and card immediately on any edit or deletion.
3. Keep stale findings and underlines visible until manually dismissed.

Decision: choose option 1.

* Never interrupts active revision: a writer who clicks a finding and
  starts rewriting the sentence can still see the original note in the
  `Findings` tab while finishing the rewrite, without a distracting
  underline clinging to half-edited words.
* Never leaves ghost findings on deleted text: cutting a sentence or scene
  removes its findings silently with a polite assistive-technology update
  rather than leaving orphaned cards to clean up by hand.
* Accurate detection requires editor position mapping: prototype testing
  showed that simple word-overlap matching mistakes a thorough in-place
  rewrite for a deletion. The implementation maps finding spans through
  ProseMirror transaction steps (`Mapping.map`), treating a modified
  non-empty span as `Passage changed` and a collapsed/removed span as
  deleted.

### Collapsed-pane signaling without interruption

When the Assistant pane is collapsed:

* The header's Assistant toggle shows ADR 0011's quiet active-findings
  count badge for the open document.
* A subtle pulsing dot appears on the toggle while either a background
  review or a streamed Chat reply is in progress.
* If a streamed Chat reply finishes while the Assistant pane is collapsed
  (or while the writer switched to another tab), a distinct quiet unread
  chat dot appears on the Assistant toggle (and on the `Chat` tab) until
  the writer views Chat.
* None of these signals opens the pane, shows a toast or modal, shifts the
  writing column, or moves keyboard focus. Screen-reader users receive a
  single polite `aria-live="polite"` status update when findings or a reply
  arrive.

### Inspectable provenance ("What it read")

Every assistant reply in `Chat` and every finding card in `Findings` carries
a collapsed-by-default `What it read` disclosure:

* Expanding a chat reply's disclosure shows the model (`gemma4:31b-mlx`),
  prompt name and digest (`conversation-grounded`), timing (first token,
  total time, output tokens), the exact list of sources sent (document
  snapshot, selection, living artifacts, explicit attachments), and a brief
  grounding summary.
* Expanding a finding card's disclosure shows the review model
  (`muse-glimmer:30b-mlx`), trigger scope, sources read (open document and,
  for chained checks, the living artifacts consulted), and why the agent
  ran.
* Living artifacts in `Reference` keep ADR 0011's source passage citations,
  `Extracted` / `Edited by you` / `Conflict` badges, plain `Save`, and
  `Revert to extracted`.

## End-to-end writer journeys

Each journey below traces the writer's first action through the last visible
result, incorporating ADR 0011's surfaces and controls.

### 1. Asking in Chat about the open document or a selection

1. Writer has a document open (for example, *Chapter 1: Low Tide at
   Oakhaven*) and opens the Assistant pane (`Mod+Shift+\` or header toggle)
   to the `Chat` tab (or presses `F6` to move focus there).
2. In an empty new chat, Writer shows the active context chip
   (`Chapter 1 · Story notes & artifacts`), a `+ Context` control, and
   three clickable starter prompts mirroring the core requests:
   * "Give me some ideas about how I can improve this text"
   * "How can I further develop this text?"
   * "What other ideas should I explore?"
3. Optionally, the writer highlights a passage in the editor before moving
   to Chat. A `Selection: "…"` chip appears above the composer (with `×` to
   broaden back to the whole document). Optionally, the writer clicks
   `+ Context` to attach another document or an earlier chat thread.
4. Writer clicks a starter prompt or types a question and presses `Enter`
   (`Shift+Enter` for a newline).
5. The writer's turn appends immediately (showing any selection snippet and
   attached context). A streaming assistant turn appears with a quiet
   "Reading draft…" status, `Send` disables to prevent duplicate submits,
   and a `Stop` button appears immediately while waiting for the first
   token. If background review is currently using the GPU, the service
   pauses or yields it so the chat turn takes priority.
6. Within the target first-token window (~2 s median on the reference
   machine), tokens stream into the reply. The writer can read, scroll, or
   click `Stop` at any moment; stopping preserves whatever text arrived and
   marks the turn `Stopped`. The editor stays responsive throughout, and
   collapsing the pane lets the reply finish quietly with the unread chat
   dot.
7. When the reply finishes, it displays concise numbered advice grounded in
   clickable verbatim double-quoted excerpts and brief italicized phrasing.
   Clicking any quoted excerpt scrolls the editor to that passage and
   highlights it briefly; expanding `What it read` reveals the exact
   sources, model, prompt version, and timing.

### 2. Writing while background review runs and noticing findings

1. Writer drafts continuously in the editor with the Assistant pane either
   open or collapsed.
2. While keys are arriving, no pause review runs and no underline changes;
   any in-flight pause review cancels on the next keystroke before touching
   decorations.
3. After typing stops for ADR 0011's quiet window (2.5 to 3 s on AC, 10 to
   15 s on battery), only changed paragraphs or scenes that pass ADR 0011's
   zero-cost structural quietness gates are sent for review. The Assistant
   status bar reads `Reviewing prose…` (or shows the subtle pulsing dot on
   the collapsed toggle).
4. When findings arrive (respecting ADR 0011's caps of at most 3
   pause-triggered findings per scene and 6 per chapter, with no overlapping
   underlines), subtle hairline underlines settle on the affected passages
   without moving the caret or shifting layout. If the pane is collapsed,
   the header toggle shows the quiet active-findings count badge.
5. Once the chapter settles (navigating away, 5 minutes idle on AC after
   substantive edits, or session end), incremental extraction updates
   `Reference` artifacts silently, chained checks (`Continuity check`,
   `Character voice`, `Scene purpose and pacing`) add any chapter findings,
   and `Reader reaction` appears as a collapsed card at the top of
   `Findings`.

### 3. Following a finding to its passage, acting on it, or dismissing it

1. Writer notices a hairline underline in the editor (or opens `Findings`
   and picks a card from reading order, optionally filtered by `All`,
   `Prose`, `Continuity`, `Questions`, `Chapter`, or `Rules`).
2. Clicking the underlined passage opens the Assistant pane (if collapsed)
   to `Findings` and highlights that card. Clicking a card scrolls the
   editor to its passage and highlights the span; continuity findings also
   offer a cross-chapter comparison link that opens the conflicting
   document at its source passage.
3. If the writer edits the passage in place to address the note, the
   underline disappears immediately and the card switches to `Passage
   changed` (with `Recheck now` and `Dismiss`) so the writer can still
   refer to the note while finishing the edit. On the next pause pass (or
   `Recheck now`), the finding clears if fixed or refreshes if the issue
   remains.
4. If the writer deletes the passage outright, the underline and card
   auto-resolve quietly.
5. If the writer disagrees with a finding, clicking `Dismiss` removes its
   underline and card immediately and records the dismissal against that
   unchanged text so it does not return on later passes unless the passage
   changes materially.

### 4. Answering a question or discussing a finding in Chat

1. On any finding card, the writer clicks `Answer in Chat` (for `Open
   questions`) or `Discuss in Chat` (for any other finding).
2. Writer switches the Assistant pane to the `Chat` tab. If a thread
   already exists for that finding, Writer resumes it; otherwise it starts
   a new thread anchored to that finding.
3. A pinned finding banner sits at the top of the thread naming the agent,
   the quoted passage, and a `↗ Passage` jump link back to the editor.
   Focus lands in the composer with a contextual placeholder (`Answer this
   question…` or `Discuss this note…`).
4. When the writer sends a reply, the agent receives the finding's note and
   quote alongside the open document and book artifacts, streams an
   advice-only response, and saves the thread in the chat switcher labeled
   with the finding so the writer can return to it later.

### 5. Returning later to findings and earlier conversations

1. Writer reopens Writer after a break (or navigates to a folder or
   document). ADR 0011's precomputed recursive Session recap shows
   workspace, directory-tree, or document activity with zero blocking wait,
   and clears the file banner the instant the writer types.
2. Opening a document restores its active (non-dismissed) findings and
   underlines from storage immediately without waiting for a fresh model
   call, and restores `Reference` artifacts for the active book.
3. In the `Chat` tab, clicking the thread switcher button opens the inline
   drawer, defaulting to `This document` with a one-click switch to `All
   chats`. Selecting any earlier thread restores its full transcript,
   including its `What it read` disclosures and clickable quotes.

### 6. Reviving a past conversation and seeing the text as it was

1. Writer opens an earlier thread from the `Chat` switcher on a document
   that has been edited since the conversation took place (or a thread
   started on another document).
2. A quiet revival banner appears at the top of the thread: `Document
   edited since this chat (<timestamp>)` with a `View text then` button
   (and `Open doc` if the thread belongs to a different document).
3. Clicking `View text then` opens a read-only snapshot view in the center
   region (using the same full-region pattern as ADR 0011's expanded
   Reference view), displaying the exact prose captured at that turn, with
   `← Back to current draft` and `Escape` returning immediately to the live
   editor without touching current edits.
4. If the writer sends a new message in the revived thread, Writer inserts
   a subtle `Continuing against the current draft` divider before the new
   turn and grounds the new reply in the current document while keeping the
   earlier turns intact.
5. Every earlier turn whose captured text differs from the current draft
   retains a quiet `Text then` button in its turn header, so historical
   snapshots stay inspectable even after the thread continues on a newer
   draft.

### 7. Seeing what the agent read and why it said what it did

1. Writer wants to verify whether an assistant reply or background finding
   relied on the right chapter, selection, or living artifact.
2. On any assistant message in `Chat` or any card in `Findings`, the writer
   expands the collapsed `What it read` disclosure.
3. Writer displays the model name, prompt identifier, timing/token counts
   (for Chat), exact source list (open document or historical snapshot,
   selection, book living artifacts, explicit `+ Context` attachments), and
   a concise explanation of why the note was produced.
4. For extracted facts in `Reference`, clicking `↗ Source passage` jumps
   straight to the originating passage, and provenance badges show whether
   a fact is `Extracted`, `Edited by you`, or `Conflict`.

### 8. Pausing background work, overriding low battery, and deleting chats

1. Pausing background work: clicking `Pause` in the Assistant pane header
   or pressing `Mod+Shift+P` immediately cancels any in-flight background
   review or artifact extraction, stops all background triggers, and sets
   the status bar to `Paused by you · Chat ready`. On-request `Chat`
   remains completely usable. Clicking `Resume` (or `Mod+Shift+P`) restores
   normal cadence.
2. Low-battery auto-pause: when the local service reports battery at or
   below 20% or OS Low Power Mode (ADR 0011), background work pauses
   automatically (`Auto-paused (low battery)`). Clicking `Resume anyway`
   overrides the pause for the current session; Chat stays available either
   way.
3. Deleting a conversation: while viewing any saved chat thread, clicking
   `Delete` in the `Chat` toolbar opens a quiet inline confirmation strip
   (`Delete this conversation permanently?` with `Delete` and `Cancel`,
   never a browser modal). Confirming deletes the thread and any turn
   snapshots not referenced elsewhere, returns the `Chat` tab to a clean
   new chat, and leaves every document and living artifact untouched.

### 9. No provider configured, offline use, and agent failures

1. No provider configured (Ollama not installed, not running, or required
   models not pulled):
   * The workspace, navigator, editor, and autosave work identically with
     zero degradation or nagging banners.
   * The Assistant status bar reads `Pair writer not set up`, `Pause`
     hides, and both `Findings` and `Chat` show a calm empty/setup notice
     pointing to local Ollama setup (`service/README.md`).
   * Sending in `Chat` is disabled until a provider is reachable; if the
     writer already typed a message before the provider went away, the
     draft stays intact in the composer.
2. Offline use (no internet connection, local Ollama running):
   * Writer continues working with full local functionality: prose never
     leaves the machine, local Chat and background review keep running, and
     a subtle `Offline (local)` status note confirms local operation
     without raising an error.
3. Agent failure (Ollama crashes, times out, or drops mid-stream):
   * In `Chat`, streaming stops cleanly and an inline error card explains
     what happened (without leaking raw stack traces or manuscript text)
     alongside a `Retry` button. The writer's prompt is never cleared or
     lost, and any partial text streamed before the failure stays visible.
   * In background review, the failure clears the running indicator, logs
     only sanitized error metadata, leaves existing findings and underlines
     untouched, and retries quietly on the next eligible pause rather than
     showing a modal error dialog.
4. No document open (Workspace root or folder recap view):
   * `Findings` calmly notes `Open a document to see its passage findings.`
   * `Chat` notes that no document is open and invites the writer to open a
     document (or attach documents with `+ Context`).

## Performance, resource, and responsiveness targets

Every target below is grounded in
[ADR 0010](./0010-pair-writing-models.md)'s measurements on the reference
laptop (Apple M5 Max, 128 GB, Ollama MLX builds) and
[ADR 0008](./0008-editor.md)'s editor targets. Unplugged battery drain and
host-browser GPU typing measurements are tracked in
[backlog 59](../backlog/0059-battery-and-typing-check.md) and will amend
these targets if real unplugged behavior diverges materially.

| Dimension                       | Target                                                                    | ADR 0010 / ADR 0008 measured basis                                                              | Notes                                                                    |
|---------------------------------|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| Chat time to first token        | <= 3 s median (single doc + compact artifacts)                            | `gemma4:31b-mlx` + `conversation-grounded`: 1.9 s (tune), 2.3 s (holdout)                       | Avoids 15 to 100 s manuscript wait via artifacts; opt-in models may vary |
| Chat streaming rate             | >= 25 tok/s idle; >= 12 tok/s if review overlaps; yield review on Chat    | `gemma4:31b-mlx`: 28.6 to 38 tok/s idle; 14.6 tok/s under concurrent `muse-glimmer:30b-mlx`     | Architecture must pause/yield background review while Chat streams       |
| Pause-triggered review          | <= 20 s per changed paragraph/scene; instant cancel on keystroke          | `muse-glimmer:30b-mlx`: 17 s scene; `gemma4:31b-mlx`: 3 s scene                                 | Never blocks typing; unchanged blocks skipped by content hash            |
| Chapter-settled extraction      | <= 30 s per changed chapter                                               | `muse-glimmer:30b-mlx`: 17 s chapter; `gemma4:31b-mlx`: 8 s chapter                             | Incremental deltas avoid 75 to 92 s full-manuscript pass                 |
| Peak model memory               | <= 36 GB (48 GB+ dual MLX); <= 18 GB (32 GB); <= 14 GB (24 GB); <= 9 GB   | Measured 35.6 GB dual MLX, 18.3 GB Gemma 4 31B, 14.1 GB Gemma 4 12B, 8.8 GB Qwen 3.5 9B         | Leaves >= 12 GB on 48 GB machine for OS, browser, and Writer             |
| Power and battery               | AC <= ~60 W bursts, no thermal warning; battery <= 10% duty (~4.5 W avg)  | ADR 0010 AC sustained review: 60.0 to 61.7 W (~45 W over 15 W idle, ~1.2 h continuous on 72 Wh) | Low battery (<= 20% or Low Power Mode) auto-pauses; verified in item 59  |
| Typing responsiveness (1 MiB)   | Keystroke p95 < 50 ms (4x throttle), < 33 ms unthrottled; serialize <= 25 | ADR 0008 & `responsiveness.spec.ts`; ADR 0010 container test: 17 ms (1x), 25 to 27 ms (4x)      | Zero measurable degradation during review; host GPU checked in item 59   |
| Session recap & pane navigation | 0 ms blocking model wait on navigation                                    | Precomputed on idle/shutdown per ADR 0011                                                       | Switching docs, folders, tabs, or threads never blocks on model I/O      |

## What extending the prototype showed

We extended ADR 0011's throwaway prototype in ignored `.local/prototype/`
(kept out of the repository) with separate named threads, pre-seeded
historical conversations against an earlier draft of Chapter 1, clickable
starter prompts, selection capture, `+ Context` document and chat
attachments, simulated TTFT and token streaming with `Stop`, clickable
verbatim quotes, read-only `View text then` snapshots, collapsed `What it
read` disclosures on both replies and findings, in-place edit vs. deletion
reconciliation, collapsed-pane unread chat signaling, inline delete
confirmation, and a `Provider` simulator (`Ollama ready`, `Offline`, `No
provider configured`, `Agent failure`). Walking every journey interactively
in the browser surfaced four concrete design changes incorporated above:

* Immediate `Stop` control during the TTFT wait: in the first build,
  streaming state flipped only once the first chunk timer started, leaving
  `Send` active and `Stop` hidden during the initial wait. Because Gemma 4
  31B takes ~2 seconds to first token (and slower opt-in models like Qwen
  3.8 27B take 12 to 18 seconds), the UI must enter streaming state the
  instant the writer submits, showing `Stop` immediately and preventing
  double-sends.
* Per-turn `Text then` access after continuing a revived thread: once a
  writer sent a follow-up in a revived thread, the top-of-thread `Document
  edited since this chat` banner vanished because the newest turn matched
  the current draft, hiding yesterday's snapshot. Adding a quiet `Text
  then` button on every historical turn whose snapshot differs from the
  current draft keeps earlier prose inspectable even inside a continued
  conversation.
* Position mapping rather than word overlap for edited vs. deleted
  passages: rewriting a clichéd sentence thoroughly in place changed enough
  words that a word-overlap heuristic mistook the edit for a deletion and
  auto-resolved the card while the writer was still revising. The
  production editor must map anchors through ProseMirror transaction steps
  to distinguish an in-place edit (`Passage changed`) from a removed span
  (auto-resolve).
* Clearing captured selection on edit or `New chat`: preserving a captured
  editor selection across focus into the composer solved blur loss, but
  leaving it pinned after the writer edited another paragraph or clicked
  `+ New` silently narrowed an unrelated question. Clearing the selection
  chip automatically on document edits and new chats keeps selection scope
  intentional and predictable.

## Requirements on downstream ADRs and backlog

### Requirements on the agent architecture ADR (backlog 10)

* GPU scheduling and cancellation: prioritize on-request Chat turns over
  background review on the shared local GPU (pausing or yielding in-flight
  background work when a Chat turn begins), cancel pause reviews on any new
  keystroke or Pause, and cancel in-flight Chat streams immediately on
  `Stop`.
* Context assembly within local windows: assemble open document + active
  selection + active book's compact living artifacts + opt-in extra
  documents or chat threads without rereading the whole manuscript unless
  explicitly attached, keeping Chat TTFT within 3 seconds median on the
  reference machine.
* Streaming and structured metadata: stream Chat replies over SSE per
  [ADR 0004](./0004-api-conventions.md), returning structured audit
  metadata (`model`, `prompt` version/digest, `sources`, `ttftMs`,
  `totalMs`, token counts) for `What it read`, and distinct RFC 9457
  `Problem` codes for no-provider configured, provider unreachable, and
  mid-stream failure without leaking manuscript text.
* Passage anchors for ProseMirror mapping: design finding anchors so the
  webapp maps them accurately through ProseMirror transaction steps to
  separate in-place edits (`Passage changed`) from deletions
  (auto-resolve). No rewrite-application or inline-diff mutation path is
  needed in the editor.
* Resource and responsiveness enforcement: honor ADR 0010's memory tiers,
  ADR 0011's quietness gates, density caps, and OS power-state battery
  cadence, and verify zero regression on `responsiveness.spec.ts`.

### Requirements on the agent conversations ADR (backlog 37)

* Separate named threads: model conversations as distinct threads with
  stable IDs, editable/generated titles, document/book scope, optional
  `findingId` link (enabling idempotent `Answer in Chat` / `Discuss in
  Chat` handoffs), and timestamps, filterable by document or workspace.
* Per-turn immutable document snapshots: record the document text (or a
  durable snapshot reference) associated with each turn so `View text then`
  and per-turn `Text then` work reliably even after the document is edited,
  renamed, moved, or deleted, and even after a revived thread continues on
  a newer draft.
* Audit record per turn and per finding: store the model, prompt digest,
  source list (including selection and explicit attachments), timing, and
  token use needed for the `What it read` disclosure, with a strict rule
  that no conversation or manuscript text ever enters service logs.
* Permanent thread deletion and finding dismissals: deleting a conversation
  permanently removes the thread and unreferenced snapshots without
  touching workspace documents or living artifacts; dismissing a finding
  persists against unchanged passage text so it stays hidden across
  reloads.
* Living artifacts and recursive recaps: co-locate ADR 0011's book-scoped
  living artifacts (`Story notes`, `Timeline`, `Reverse outline`, `Open
  threads`, `Reader reaction`, `The writer's own rules`) and tree-scoped
  session recap records alongside conversations in every planned backend.

### Revisions to delivery backlog stories

* [Backlog 10](../backlog/0010-agent-architecture-adr.md) and
  [backlog 37](../backlog/0037-agent-conversations-adr.md): remove backlog
  38 from prerequisites and bind them to this ADR's requirements and
  targets.
* [Backlog 12](../backlog/0012-first-pair-writing-agent.md): keep
  conversation replies advice-only, stream with cancellation, emit audit
  metadata, and return distinct problem details when no provider is
  configured or reachable.
* [Backlog 34](../backlog/0034-assistant-pane-agent.md): build the `Chat`
  tab's separate threads, inline switcher drawer, `+ New`, inline-confirmed
  `Delete`, starter prompts, selection capture (cleared on edit and new
  chat), `+ Context` attachments, immediate `Stop`, clickable verbatim
  quotes, `What it read` disclosure, revival banner and per-turn `Text
  then` snapshot view, collapsed-pane unread chat dot, and no-provider,
  offline, failure+`Retry`, and no-document states.
* [Backlog 35](../backlog/0035-service-background-review.md): attach
  `What it read` source metadata to findings, yield background review to
  active Chat turns, and persist dismissals keyed to unchanged text.
* [Backlog 36](../backlog/0036-background-findings-view.md): implement
  ProseMirror-mapped edit (`Passage changed` with `Recheck now` and
  `Dismiss`) vs. deletion (quiet auto-resolve) handling, `What it read`
  disclosures on findings, and idempotent `Answer in Chat` / `Discuss in
  Chat` thread handoffs.

## Consequences

### Positive

* Writers get a calm, predictable, keyboard-operable pair writer across
  conversation, findings, reference artifacts, and session recaps without
  sacrificing authorship or typing speed.
* Advice-only replies with clickable verbatim quotes keep ADR 0008's editor
  undo and byte-exact round trip simple and steer clear of model
  usage-policy ambiguity on human-generated prose.
* Separate threads with per-turn snapshots make finding handoffs, revival,
  and deletion clean, while compact living artifacts keep local first-token
  latency near 2 seconds.
* Downstream ADRs (backlog 10 and 37) and delivery stories (backlog 12, 34,
  35, and 36) have concrete UX contracts and measured targets to build to.

### Negative

* Writers who explicitly want one-click AI insertions or inline diff
  application will need to copy or retype suggested phrasing manually.
* Persisting per-turn snapshots (or content-addressed snapshot references)
  adds storage design work for backlog 37 so long histories do not bloat
  workspace folders.
* Relying on compact living artifacts by default means cross-chapter
  questions about subtle details not yet extracted into Story notes require
  explicitly attaching the other chapter via `+ Context`.

## Revisit triggers

* Writers using the delivered pair writer consistently ask for an explicit
  one-click `Apply to selection` action on requested rewrites: evaluate an
  opt-in single-undo ProseMirror transaction after verifying model license
  and usage-policy compatibility.
* [Backlog 59](../backlog/0059-battery-and-typing-check.md) finds unplugged
  battery drain or host-browser GPU typing latency diverges materially from
  ADR 0010's AC and container estimates: adjust the power, battery, or
  scheduling targets above.
* [Backlog 40](../backlog/0040-cloud-model-fallback-adr.md) introduces an
  opt-in cloud fallback: amend the offline, privacy, and `What it read`
  journeys to disclose clearly when a turn uses a remote model and require
  explicit consent.
* [Backlog 55](../backlog/0055-compare-models-in-use.md) or
  [backlog 57](../backlog/0057-model-settings.md) shifts the default model
  away from `gemma4:31b-mlx`: revisit the 3-second TTFT target if writers
  prefer a slower, higher-scoring model such as `qwen3.8:27b-mlx`.
