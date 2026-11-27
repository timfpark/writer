---
title: "ADR 0012: Pair-writing experience"
description: Designs how writers work with the pair writer in conversation and background review around ADR 0011's agents, keeping suggestions advice-only, organizing chat in threads that record what each reply read, bounding what the agent reads, handling edited passages, amending ADR 0011's pause trigger, and setting latency, memory, battery, and typing targets from ADR 0010's measurements
author: Tim Park
ms.date: 2026-11-27
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
estimated_reading_time: 15
---

## Status

Accepted on 2026-11-27.

This record designs the writer's experience of the pair writer around the
agents, surfaces, and battery policy of
[ADR 0011](./0011-background-agents-ux.md) and the models measured in
[ADR 0010](./0010-pair-writing-models.md). It settles
[ADR 0008](./0008-editor.md#follow-up-decisions)'s follow-up on how
suggestions are shown and accepted, and amends ADR 0011's short-pause trigger
so a keystroke cancels only the reviews whose text it changes. The
[agent architecture ADR](../backlog/0010-agent-architecture-adr.md)
(backlog 10) and the
[agent conversations ADR](../backlog/0037-agent-conversations-adr.md)
(backlog 37) must meet its requirements. Its battery and typing targets rest
on ADR 0010's AC and container measurements until
[backlog 59](../backlog/0059-battery-and-typing-check.md) measures unplugged
drain and typing in a host browser.

## Decision summary

* Keep the pair writer advice-only. Replies and findings quote the writer's
  text and may suggest wording, but Writer never puts agent text into the
  document; the writer types or copies what they choose.
* Organize `Chat` in threads. Each finding's `Answer in Chat` or `Discuss in
  Chat` opens that finding's own thread, a switcher lists threads by last
  activity, and one reply streams at a time, finishing in its thread even if
  the writer moves on.
* Ground every turn in the text on screen: the open document as it stands,
  unsaved edits included, with the selection as its focus, plus the book's
  living artifacts and any documents the writer adds with `+ Context`. A turn
  reads at most about 19,000 words, the context ADR 0010 measured memory
  with; a longer document is read around the selection or the cursor. The
  composer shows what the next turn will read.
* Record what every reply and finding read, and let the writer reopen each
  document source exactly as it was read. A thread whose document has
  changed says so and offers the text as it stood.
* Treat an edit inside a flagged passage as `Passage changed`: the underline
  goes at once, and the card stays until the next pause review of that text
  replaces it. Deleting the passage removes its finding, and a dismissal
  holds while the passage's text is unchanged.
* Amend ADR 0011's short-pause trigger: a keystroke cancels a review only
  when it changes the text under review. Other reviews finish, and their
  underlines wait for the next pause. A chat turn stops background review
  until its reply ends.
* Signal without interrupting: underlines show findings in place, the
  collapsed assistant toggle keeps ADR 0011's findings count, and one dot on
  it pulses while the pair writer works and stays lit while a reply waits
  unread. `F8` and `Shift+F8` move between findings from the keyboard.
* Keep writing independent of the pair writer: offline changes nothing, a
  missing Ollama or model gets a notice naming the fix, and a failed reply
  keeps the writer's message with `Retry`.
* Hold replies to targets grounded in ADR 0010: a first token within 3 s for
  scene-length reads and for follow-ups on text already read, plus about 3 s
  per further 1,000 words on a first read; memory within ADR 0010's tiers;
  ADR 0011's battery policy; and ADR 0008's typing targets while reviews run
  and replies stream.

## Context

The [README](../../README.md#overview) promises a pair writer that answers in
the assistant pane and reviews the writer's text in the background. Earlier
records fixed what that experience builds on:

* [ADR 0005](./0005-workspace-model.md) allows documents up to 1 MiB, about
  the length of a long novel, and makes deletion permanent.
* [ADR 0007](./0007-webapp-interface.md) sets the three-region shell, its
  tokens and breakpoints, and keyboard movement between regions with `F6`.
* [ADR 0008](./0008-editor.md) sets the editor, its byte-preserving Markdown
  round trip, undo, autosave, and typing targets, and leaves open how
  suggestions are shown and accepted.
* [ADR 0010](./0010-pair-writing-models.md) chose `gemma4:31b-mlx` with the
  `conversation-grounded` prompt for conversation and `muse-glimmer:30b-mlx`
  for review, and measured their speed, memory, and power on the reference
  laptop.
* [ADR 0011](./0011-background-agents-ux.md) chose the fifteen Wave 1
  background agents, their triggers, hairline underlines with density caps,
  the `Findings`, `Reference`, and `Chat` tabs, session recaps, `Pause`, and
  the battery policy.

Backlog 25 built the assistant pane around a stub behind the `Assistant`
interface in [conversation.ts](../../webapp/src/workspace/conversation.ts).
This record designs the rest of the experience before backlog 10 chooses how
the agent is built and backlog 37 chooses how conversations are stored. We
tried it by extending ADR 0011's throwaway prototype in ignored
`.local/prototype/`.

ADR 0010's per-case results shape several decisions. With
`conversation-grounded`, `gemma4:31b-mlx` started replying in a median 2.1 s
for scenes of about 550 words, 3.2 s for chapters of about 1,200 words, and
57 s for the 18,800-word manuscript. It reads a prompt at about 450 to 650
tokens a second, so each 1,000 words read adds about 3 s before the first
token. A prompt Ollama had already processed started in 0.3 to 0.6 s, the
manuscript included.

## Decision drivers

* The writer's authorship and focus come first: the agent advises, asks, and
  cites; it never edits the document, takes focus, or crowds the 36 em page.
* Local models set the pace: text stays on the writer's machine, so every
  wait, memory peak, and watt follows ADR 0010's measurements.
* Drafts keep changing: findings must follow edits, and old conversations
  must still show the text they discussed.
* Trust needs evidence: the writer can always see what the agent read and
  why it spoke, without that detail crowding the page.
* Keyboard and screen-reader use are first-class, as ADR 0007 and
  [ADR 0009](./0009-browser-tests.md) require: no focus theft, polite
  announcements, and a keyboard path to every action.

## Decision

Terms used below: a thread is one conversation in the `Chat` tab; a turn is
one message from the writer and its reply; a pause review is ADR 0011's
check of changed paragraphs and scenes after the writer stops typing.

### Suggestions stay advice

The pair writer advises; it never edits. Findings and replies quote the
writer's text exactly and may suggest wording in italics, or a fuller
rewrite when the writer asks for one, but no control places agent text in
the document. The writer types or copies what they choose, so every change
to the document is the writer's own edit, and ADR 0008's undo, autosave, and
byte-preserving saves need nothing new.

A quote that matches the current text exactly is a link: activating it
scrolls the document to the passage and highlights it briefly. A quote of
text that has since changed stays plain, and the reply's sources show it as
it was.

We weighed three options:

1. Advice only, chosen.
2. An `Apply to selection` button on a requested rewrite, applied as one
   undoable edit.
3. Inline diffs with accept and reject on findings and replies.

Advice only won for three reasons:

* Writer helps the writer think and revise rather than ghostwrite, and ADR
  0010's prompt already keeps suggested wording short unless the writer asks
  for more.
* ADR 0010 notes that Muse Glimmer's usage policy asks users not to present
  its output as human-written. Writer never inserts model text, so it never
  presents model output as the writer's.
* A rewrite proposed for text that has changed since would need conflict
  handling that options 2 and 3 must design; advice needs none.

The cost is a manual step for a writer who wants a suggestion verbatim, and
the revisit triggers say when to reconsider option 2.

### Threads in the Chat tab

`Chat` holds separate threads, as coding assistants do. Its header shows the
current thread's title as a switcher, with `+ New` and `Delete`:

* A thread belongs to the document open when it started, and takes its title
  from its first message or its finding, without a model call. Opening a
  document reopens the thread last used with it, or a new thread.
* The switcher lists threads by last activity, under `This document` or
  `All chats`. A thread about another document can be read from there; to
  continue it, `Open document` opens its document.
* `Answer in Chat` on an open question and `Discuss in Chat` on any other
  finding open that finding's thread, or resume it. The finding stays pinned
  at the top of the thread with a link to its passage, and replies read the
  finding and any passage it cites in another document. Answering does not
  resolve the finding; the writer revises the passage or dismisses it.
* One reply streams at a time. It keeps streaming into its thread when the
  writer switches threads, tabs, or documents, or collapses the pane; only
  `Stop`, or deleting the thread, ends it early.
* `Delete` asks inline, then removes the thread and everything it recorded;
  documents and living artifacts are untouched.
* Deleting a document keeps its threads under `All chats`, marked as about a
  deleted document, until the writer deletes them, and the navigator's
  delete confirmation says so.

We weighed one conversation per document and one for the whole workspace.
Both tangle finding discussions with unrelated topics, make a dead end
impossible to delete without losing the rest, and grow a history that every
turn rereads.

### What the agent reads

Each turn reads:

* The open document as it stands when the writer sends, including edits not
  yet saved. A selection is the turn's focus; the agent still reads around
  it to judge how the passage fits, as ADR 0010's cases and prompt assume.
* The open book's living artifacts (`Story notes`, `Timeline`, `Reverse
  outline`, `Open threads`, and the writer's rules) once backlog 49, 50, and
  53 deliver them, for consistency across chapters without rereading them.
* Documents the writer adds with `+ Context`, and the thread's earlier turns.

Nothing else is read: no other thread, no session recap, and no other
document unless added.

A turn reads at most about 19,000 words (about 25,000 tokens), the context
included in ADR 0010's memory peaks. A longer open document is read around
the selection, or around the cursor when nothing is selected, up to that
limit. Added documents, artifacts, and the thread's history count toward it:
`+ Context` cannot add past it, and once a thread outgrows it, the oldest
turns drop out of the reading first.

The composer shows the reading before it happens: the document and how much
of it is read (whole, or around the selection or cursor), the selection, the
artifacts, added documents, and the word count. The selection chip mirrors
the editor: it appears while text is selected there, the editor keeps that
passage highlighted while focus is in `Chat`, and the chip goes when the
selection does. Its `×` ignores the selection for the next message.

We weighed three alternatives:

* The document and selection only. Answers would miss story facts settled
  in other chapters.
* The whole book on every turn. A first read of the 18,800-word manuscript
  took 51 to 57 s before the first token, and books outgrow the context ADR
  0010 measured memory with.
* Attaching earlier threads with `+ Context`. Their transcripts lengthen
  every read, and continuing in that thread is simpler.

Reading the whole document up to the limit costs a wait on the first read of
long text, which the reply announces while it reads. Follow-up turns reuse
that read and start quickly, so answers stay complete without repeating the
wait.

### Findings when their passage changes

* An edit inside a flagged passage removes its underline at once and marks
  its card `Passage changed`, so the note stays readable while the writer
  revises. The next pause review of that text replaces the card with
  whatever it finds, which may be nothing.
* Deleting the passage removes its finding quietly, with a polite
  announcement.
* `Dismiss` removes a finding and suppresses that agent's findings on the
  same exact text until the text changes.
* While background work is paused, changed cards wait for the next review or
  a dismissal.
* Findings persist across sessions. On reopening, or after the file changes
  outside Writer, a finding reattaches only where its quoted text still
  appears exactly; otherwise it is dropped, and the next review starts fresh.

Within a session, the webapp tells an edit from a deletion by mapping each
finding's range through the editor's transactions with ProseMirror's
position mapping: a range that survives with changed text is an edit, and a
range that collapses is a deletion.

We weighed clearing a finding on any edit, which loses the note
mid-revision, and keeping it until dismissed, which leaves stale underlines
and notes about deleted text.

### Pause reviews keep running while the writer types elsewhere

ADR 0011's short-pause trigger cancelled an in-flight pause review on any
keystroke. A scene review takes up to about 17 s on Muse Glimmer, so a
writer who resumed typing within that time would rarely see findings, and
battery would go to reviews thrown away. This record amends the trigger:

* A keystroke cancels a pause review only when it changes the text under
  review; that text is reviewed again at the next pause.
* Any other review finishes, and its underlines wait for the next pause, so
  underlines still never change while the writer types.
* Sending a chat message stops any review in flight, and review resumes at
  the next pause after the reply ends, so a reply never waits behind a
  review.

### Signals and keyboard access

* Findings show where they belong: as underlines on the page and, while the
  assistant is collapsed, as ADR 0011's count of the open document's active
  findings on its toggle. The count summarizes; it is not an unread signal,
  because the underlines already show every finding in place.
* Replies are not on the page, so they get an unread signal. One dot on the
  assistant toggle pulses while the pair writer reviews or replies, and stays
  lit when a reply finished unseen, until the writer views that thread. The
  `Chat` tab and the thread's switcher entry carry the same dot. The toggle's
  accessible name states which, so the state never depends on motion, which
  ADR 0007 turns off for writers who reduce it.
* None of these opens the pane, shows a toast, shifts the page, or moves
  focus. A polite live region announces a finished reply and a review that
  changes the findings count.
* `F8` and `Shift+F8` move the caret to the next or previous flagged
  passage, highlight its card, and announce its agent and note. `F6` then
  moves focus to that card's actions.

We weighed a second unread dot beside ADR 0011's running dot, which crowded
three signals onto one 2 rem button, and counting unread findings, which
duplicates the underlines and nags while drafting.

### What it read

Every reply and finding carries a collapsed `What it read` disclosure:

* Its sources: the document (whole, or which part), the selection, added
  documents, and living artifacts, plus a finding's trigger. Each document
  source opens read-only in the writing region exactly as the agent read it,
  and `Back to current draft` or `Escape` returns.
* Why it ran: a sentence built from recorded facts, such as the writer's
  message or the agent and trigger, never a model's account of itself.
* The model and prompt version.

Timing and token counts go to the audit record backlog 37 keeps, not to the
disclosure.

A thread whose document changed since its latest turn opens with `Document
edited since this chat` and `View text then`, which opens that turn's
reading. Sending a new message adds a `Continuing against the current draft`
divider, and earlier turns keep their own sources. Living artifacts in
`Reference` keep ADR 0011's source citations and provenance badges.

## Journeys

Each journey runs from the writer's first action to its last visible result.

### 1. Asking about the open document or a selection

1. With a document open, the writer opens the assistant (`Mod+Shift+\` or
   its toggle) to `Chat`, or moves there with `F6`.
2. A new thread shows the reading, such as `Chapter 1 · whole · 4,200 words`
   and the living artifacts, and three starter prompts: "Give me some ideas
   about how I can improve this text", "How can I further develop this
   text?", and "What other ideas should I explore?".
3. To focus on a passage, the writer selects it first, and a selection chip
   appears. `+ Context` adds other documents.
4. The writer picks a starter, or types a question and presses `Enter`
   (`Shift+Enter` adds a line).
5. The turn appears at once. Until the first token, the reply reads
   `Reading 4,200 words…`, `Send` is disabled, and `Stop` is ready.
   Background review stops until the reply ends.
6. The reply streams faster than the writer reads. `Stop` keeps what arrived
   and marks the turn `Stopped`. The writer can keep typing in the document,
   switch threads, or collapse the pane, and the reply finishes in its
   thread.
7. The finished reply gives a few numbered points that quote the text. Each
   exact quote links to its passage, and `What it read` lists the sources.

### 2. Writing while background review runs

1. The writer drafts with the assistant open or collapsed. No review starts
   while keys arrive.
2. After ADR 0011's quiet window (2.5 to 3 s on AC, 10 to 15 s on battery),
   changed paragraphs and scenes that pass its quietness gates are reviewed.
   The status line reads `Reviewing prose`, or the collapsed toggle's dot
   pulses.
3. If the writer resumes typing elsewhere, the review continues; typing in
   the text under review cancels it.
4. At the next pause, findings appear as hairline underlines within ADR
   0011's density caps, without moving the caret or the page, and the
   collapsed toggle's count updates.
5. When a chapter settles, ADR 0011's extraction updates `Reference`
   silently, chained checks add chapter findings, and `Reader reaction`
   appears at the top of `Findings`.

### 3. Following a finding to its passage, acting on it, or dismissing it

1. The writer clicks an underline, which opens the assistant to `Findings`
   with its card highlighted, or presses `F8` to move to the next one and
   hear its note.
2. Selecting a card scrolls to its passage and highlights it, and a
   continuity finding also links to the conflicting passage in the other
   chapter.
3. Editing the passage marks the card `Passage changed`, and the next pause
   review replaces it. Deleting the passage removes it.
4. `Dismiss` removes the finding, which stays away while that text is
   unchanged.

### 4. Answering a question or discussing a finding

1. On a card, the writer chooses `Answer in Chat` for an open question or
   `Discuss in Chat` for any other finding.
2. `Chat` opens that finding's thread, new or resumed, with the finding
   pinned at the top and focus in the message box.
3. Replies read the finding, any passage it cites in another document, and
   the usual reading. The finding stays until revised or dismissed.

### 5. Returning later

1. Opening Writer, a folder, or a document after a break shows ADR 0011's
   session recap at once, with no model call.
2. A document opens with its active findings and underlines restored, and
   `Reference` shows its book's artifacts.
3. The switcher lists the document's threads, or `All chats`, and opening
   one restores its transcript, sources, and links.

### 6. Reviving a conversation and seeing the text as it was

1. The writer opens a thread whose document changed since its latest turn.
   `Document edited since this chat` and `View text then` head the thread.
2. `View text then` shows that turn's reading read-only in the writing
   region, and `Back to current draft` or `Escape` returns.
3. A new message adds `Continuing against the current draft` and reads the
   current text. Each earlier turn's `What it read` still opens the text it
   read.

### 7. Seeing what the agent read and why

1. The writer expands `What it read` on a reply or finding.
2. It lists the sources, each document openable as read, why the agent ran,
   and the model and prompt version.
3. In `Reference`, `Source passage` links and ADR 0011's provenance badges
   answer the same question for living artifacts.

### 8. Pausing, overriding low battery, and deleting conversations

1. `Pause` or `Mod+Shift+P` cancels background work and stops its triggers.
   The status line reads `Paused by you`, `Chat` still works, findings stay,
   and edited passages stay `Passage changed` until review resumes. `Resume`
   restores ADR 0011's cadence.
2. At 20% battery or in Low Power Mode, background work pauses
   automatically, as ADR 0011 decides; `Resume anyway` overrides it for the
   session, and `Chat` works either way.
3. `Delete` in a thread's header asks inline; confirming removes the thread
   and what it recorded, and `Chat` returns to a new thread.

### 9. Setup, offline use, failures, and no open document

1. If Ollama is unreachable at `OLLAMA_HOST`, or a configured model is not
   installed, the status line and both `Findings` and `Chat` say which, name
   the model, and point to `service/README.md`. `Pause` hides and `Send` is
   disabled, but a typed message stays. The pane checks again when opened
   and before sending, so starting Ollama needs no reload. Writing and saving
   are unaffected.
2. Offline, nothing changes and nothing says so: Ollama runs on the writer's
   machine, and Writer sends text nowhere else.
3. A reply that fails ends with an inline error and `Retry`. The message and
   any partial reply stay, and `Retry` sends the message again with the
   current text.
4. A failed review is silent: existing findings stay, and the next pause
   tries again. If Ollama stops answering, the status line shows the setup
   notice.
5. With no document open, `Findings` and `Chat` ask the writer to open one,
   since every turn reads text.

## Targets

These hold on ADR 0010's reference laptop with its chosen models. Backlog 59
checks the battery and typing rows unplugged and in a host browser.

| Target          | Requirement                                                                                                                                                                                                      | Basis                                                                                                                                              |
|-----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| Reply starts    | Median first token within 3 s on a first read of up to about 1,000 words and on any follow-up over text already read; about 3 s more per further 1,000 words on a first read; never delayed by background review | 2.1 s at about 550 words, 3.2 s at about 1,200, and 57 s at 18,800 with `gemma4:31b-mlx`; 0.3 to 0.6 s when Ollama had processed the prompt before |
| Reply streams   | At least 10 tokens a second, faster than the writer reads                                                                                                                                                        | 30 tokens a second on short reads and 18 on the manuscript; 9 to 15 while a review shared the GPU, so a turn stops review                          |
| Findings appear | On AC, within about 20 s of the pause that starts a review, or at the next pause if the writer is typing                                                                                                         | Scene review in 17 s on `muse-glimmer:30b-mlx` and 3 s on `gemma4:31b-mlx`, after ADR 0011's 2.5 to 3 s quiet window                               |
| Memory          | Within ADR 0010's tiers of about 36, 18, 14, and 9 GB, by reading at most about 19,000 words a turn                                                                                                              | Peaks measured with the 25,600-token manuscript in context                                                                                         |
| Battery         | ADR 0011's policy: at most about a 10% duty cycle (about 4.5 W) on battery, and auto-pause at 20%                                                                                                                | About 60 W during review against 15 W idle, on AC                                                                                                  |
| Typing          | ADR 0008's targets hold while a review runs and while a reply streams                                                                                                                                            | 95th percentile of 17 ms unthrottled and 25 to 27 ms throttled 4× during review, in the container                                                  |
| Navigation      | Opening a document, folder, tab, or thread never waits on a model                                                                                                                                                | ADR 0011 prepares recaps ahead; threads and findings load from storage                                                                             |

## What the prototype showed

We extended ADR 0011's throwaway prototype, kept out of the repository in
`.local/prototype/`, with threads, finding handoffs, selection, `+ Context`,
streaming with `Stop`, quote links, `What it read`, earlier drafts, edited
and deleted passages, signals on the collapsed toggle, and simulated setup
states and failures, then walked every journey above. Four findings changed
the design:

* `Stop` must appear the moment the writer sends. The first build entered
  its streaming state only when the first chunk arrived, leaving `Send`
  active and `Stop` hidden through the wait, which is about 2 s on Gemma 4
  31B and 12 to 21 s on Qwen 3.8 27B.
* Each turn must keep the text it read. Once the writer continued a revived
  thread, the top banner rightly disappeared, and with it any way back to
  the text the earlier turns discussed. Each turn's sources now reopen as
  read.
* Word overlap cannot tell an edit from a deletion. A thorough in-place
  rewrite of a clichéd sentence changed enough words that the prototype
  treated it as a deletion and removed the card mid-revision, hence the
  editor's position mapping.
* The selection chip must follow the editor's selection. A captured copy
  outlived the editor's selection and narrowed later questions without the
  writer noticing. Tied to the editor's own selection, the chip survives
  focus moving into `Chat` and `+ New`, and goes when the writer clicks or
  types in the document. The editor must keep the passage highlighted while
  `Chat` has focus, because the browser's own highlight leaves with focus.

A review of this record against ADR 0010's per-case timings then corrected
its latency targets, added the reading limit, and amended ADR 0011's pause
trigger. It also dropped what the journeys did not need: a `Recheck now`
button that the next pause review already covers, an offline indicator for
a state that changes nothing, attaching earlier threads, a second unread
dot, and per-turn `Text then` buttons that `What it read` replaces. Trying
the revised design in the prototype confirmed that a reply streams on in its
thread while the writer switches threads and arrives there unread, that a
review continues while the writer types in another paragraph and shows its
underlines at the next pause, and that `F8` reaches and announces each
finding.

## Requirements on downstream ADRs and backlog

### Agent architecture ADR (backlog 10)

* Assemble each turn's reading as this record defines it, within the
  19,000-word limit: the open document as it stands, unsaved edits
  included, or the part around the selection or cursor; the living
  artifacts; added documents; and the thread's history.
* Keep the chat model's reading of unchanged text warm between turns, as
  ADR 0010's cached prompts show is possible, so follow-ups meet the
  first-token target.
* Stop background review when a turn starts, and resume it after the reply.
  Cancel a pause review only when an edit changes its text, and hold a
  finished review's underlines until the next pause.
* Report the pair writer's readiness, such as whether Ollama is reachable
  and which configured models are installed, so the pane can name what is
  missing. Map failures to [ADR 0004](./0004-api-conventions.md)'s codes:
  `unavailable` before a stream starts when Ollama or a model is missing,
  and `upstreamFailed` or `upstreamTimeout` in a stream's `error` event.
* Return with each reply and finding the facts `What it read` shows
  (sources, reason, model, and prompt version), plus timing and tokens for
  the audit record.
* Name passages so the webapp can map findings through edits and reattach
  them by exact quoted text in a later session. Nothing needs to apply
  agent text to the document.
* Meet the targets above, and keep
  [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) passing
  while a review runs and a reply streams.

### Agent conversations ADR (backlog 37)

* Store threads with their document, finding, title, last activity, and
  unread state, and turns with their selection, added documents, and status,
  including `Stopped` and failed turns.
* Keep every document source a turn or finding read, retrievable exactly as
  read, after the document is edited, renamed, moved, or deleted.
* Keep a deleted document's threads, marked, until the writer deletes them,
  and delete a thread with everything it recorded.
* Persist active findings with their quoted text, and dismissals keyed by
  agent and exact passage text.
* Keep the audit record for each turn and finding (model, prompt version,
  sources, timing, and tokens), and never write conversation text to logs.

### Delivery stories

[Backlog 12](../backlog/0012-first-pair-writing-agent.md),
[34](../backlog/0034-assistant-pane-agent.md),
[35](../backlog/0035-service-background-review.md), and
[36](../backlog/0036-background-findings-view.md) carry these decisions:
12 and 35 in the service's endpoints and review scheduling, 34 in the `Chat`
tab, and 36 in the `Findings` tab, the underlines, and `F8`.

## Consequences

### Positive

* Writers get help that never edits their text, never takes focus, and
  always shows what it read, in conversation and in review.
* Threads that keep what each turn read make handoffs, revival, and deletion
  clean, and the reading limit keeps every turn within measured memory.
* Long reviews finish while the writer types elsewhere, so findings arrive
  sooner and less battery goes to cancelled work.
* Backlog 10, backlog 37, and the delivery stories build to concrete
  journeys and measured targets.

### Negative

* A writer who wants a suggestion verbatim must type or copy it.
* The first question about a long document waits about 3 s per 1,000 words;
  only follow-ups are fast.
* A document longer than about 19,000 words is never read whole in one turn.
* Keeping what each turn read adds storage that backlog 37 must keep
  compact, for example by storing each distinct version of a document once.
* Findings wait while a reply streams, because a turn stops background
  review.

## Revisit triggers

* Writers ask for a one-click `Apply to selection` on rewrites they request:
  weigh an opt-in, single undoable edit after checking each model's license
  and usage policy.
* [Backlog 59](../backlog/0059-battery-and-typing-check.md) finds unplugged
  drain or host-browser typing well off ADR 0010's estimates: adjust the
  battery, typing, and review targets.
* [Backlog 40](../backlog/0040-cloud-model-fallback-adr.md) adds a cloud
  fallback: `What it read` and the setup states must show when a turn leaves
  the machine, with the writer's consent first.
* [Backlog 55](../backlog/0055-compare-models-in-use.md) or
  [backlog 57](../backlog/0057-model-settings.md) moves conversation to a
  slower model, such as `qwen3.8:27b-mlx`: revisit the first-token target.
* New measurements on smaller machines or longer contexts change ADR 0010's
  memory tiers: revisit the 19,000-word reading limit.
