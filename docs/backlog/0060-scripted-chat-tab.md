---
title: Try the Chat tab against a scripted pair writer
description: Build ADR 0012's Chat tab in the webapp against a provisional streaming endpoint that a deterministic scripted pair writer in the service answers, so every conversation journey runs in Writer and is tested end to end before the agent architecture is chosen.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 4
---

## Story

As the maintainer, I want ADR 0012's Chat tab running in Writer itself,
answered by a scripted pair writer, so that I can walk each conversation
journey on real documents in the real editor, test its mechanics end to
end, and change the design while that is still cheap, before a model, an
agent framework, or conversation storage is committed.

## Context

[ADR 0012](../adrs/0012-pair-writing-experience.md) fixes the conversation
experience: advice-only replies whose exact quotes link to their passages,
threads that belong to a document, a reading of the open document as it
stands, up to about 19,000 words, with the selection as its focus and
documents added with `+ Context`, `Stop` from the moment a message is sent,
`What it read` sources that reopen exactly as read, one dot on the collapsed
toggle, and setup, failure, and no-document states. It validated them in a
throwaway prototype kept in ignored `.local/prototype/`. This story moves them into
the webapp, where they meet the real editor, autosave, layout, keyboard
model, and browser tests.

Backlog 25 built the assistant pane around the `Assistant` interface in
[conversation.ts](../../webapp/src/workspace/conversation.ts), answered by
a stub that never leaves the browser.

The accepted ADRs already settle enough for a provisional path through the
service. [ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
and [ADR 0002](../adrs/0002-service-architecture.md) place the agent in a
crate below `writer-api` that exposes no axum, Tower, or utoipa types, and
stream results over SSE. [ADR 0004](../adrs/0004-api-conventions.md) frames
streams with `done` and `error` events and answers an unconfigured
capability with `503` `unavailable`.
[ADR 0003](../adrs/0003-webapp-architecture.md) leaves how the webapp reads
a stream to the first story that consumes one, which is this story.
[ADR 0009](../adrs/0009-browser-tests.md) runs browser tests against a real
service, so the scripted pair writer lives in the service, as the fake
provider that tests and demonstrations select, rather than in the browser.

The path is provisional. [Backlog 61](./0061-local-model-chat.md) puts
ADR 0010's local model behind the same endpoint, and
[backlog 62](./0062-scripted-findings-tab.md) adds the Findings tab. The
[agent architecture ADR](./0010-agent-architecture-adr.md) then keeps,
changes, or replaces the crate and endpoint, and the
[conversations ADR](./0037-agent-conversations-adr.md) decides how threads
persist, which [backlog 12](./0012-first-pair-writing-agent.md) and
[backlog 34](./0034-assistant-pane-agent.md) build. Keeping every call
behind the `Assistant` interface confines a replaced endpoint to one
module.

## Scope

* Add an agent crate below `writer-api`, such as `writer-agent`, with a
  provider interface and a deterministic scripted provider, chosen by a
  setting documented in `service/.env.example` and
  [service/README.md](../../service/README.md). Without the setting, the
  service starts with no pair writer and reports it as not ready.
* Add a provisional, stateless streaming endpoint under ADR 0004 that takes
  the writer's message and the turn's reading, and streams the reply as SSE
  events ending in `done` or `error`, with the facts ADR 0012's `What it
  read` shows: the sources read, the model, and the prompt version when a
  prompt is used. Add a provisional readiness check that says whether the
  pair writer can answer and, if not, what is missing, and answer a turn
  that cannot start with `503` `unavailable` before the stream. Regenerate
  `service/openapi.json` and the webapp's client.
* Build each turn's reading as ADR 0012 defines it: the open document as it
  stands, unsaved edits included, whole up to about 19,000 words or around
  the selection or cursor beyond that, documents added with `+ Context`,
  and the thread's earlier turns, the oldest dropping out first past the
  limit.
* Make the scripted provider derive advice-only replies from the request: a
  few numbered notes, each quoting a sentence of the document or selection
  verbatim in double quotes with a brief italicized alternative. Pace them
  like ADR 0010's model by default, with a first token after about 2
  seconds plus about 3 seconds per further 1,000 words on a first read,
  under a second on a follow-up, and about 30 tokens a second, all
  configurable so tests shorten them. Let a setting make it report a
  missing model or fail mid-stream, so tests reach those states.
* Stop generating when the client disconnects, and log no request or reply
  text.
* Read the stream behind the `Assistant` interface, choosing how as
  ADR 0003 asks, and keep the conversation state in `WorkspaceShell`.
* Build ADR 0012's first journey in the `Chat` tab: starter prompts in an
  empty thread; the reading shown above the composer, such as `Chapter 1 ·
  whole · 4,200 words`; a selection chip that mirrors the editor's
  selection, with the editor keeping the passage highlighted while `Chat`
  has focus and `×` ignoring it for the next message; `+ Context` adding
  other documents up to the limit; `Enter` to send and `Shift+Enter` for a
  new line; `Reading N words…` and `Stop` from the moment of sending, with
  no double sends; partial text kept and marked `Stopped`; exact quotes of
  the current text linking to their passage, and changed quotes left
  plain; and a collapsed `What it read` disclosure on each reply.
* Hold threads in browser memory as ADR 0012 decides: each belongs to the
  document open when it started, titled from its first message; opening a
  document reopens its last thread or a new one; a switcher lists threads
  by last activity under `This document` and `All chats`, and a thread
  about another document continues after `Open document`; `+ New` and
  inline-confirmed `Delete`; and a deleted document's threads stay under
  `All chats`, marked, as the navigator's delete confirmation says.
* Stream one reply at a time, into its own thread, while the writer
  switches threads or documents or collapses the pane, with `Send`
  disabled elsewhere until it ends.
* Keep what each turn read in memory, and open each document source in
  `What it read` read-only in the writing region exactly as read, with
  `Back to current draft` and `Escape` to return. Show the `Document edited
  since this chat` banner with `View text then` on a thread whose document
  changed, and the `Continuing against the current draft` divider.
* Show ADR 0012's single dot on the collapsed assistant toggle and the
  thread's switcher entry, pulsing while a reply streams and lit while a
  finished reply is unread, with an accessible name that says which.
  Announce finished replies politely, never open the pane or move focus,
  and keep every action operable from the keyboard.
* Show ADR 0012's setup notice, naming what is missing and pointing to
  `service/README.md`, with `Send` disabled, the typed message kept, and a
  fresh readiness check when the pane opens and before sending; an inline
  error with `Retry` that keeps the message and any partial reply and sends
  again with the current text; and the no-document state.
* Replace the stub's browser tests with tests against the real service
  running the scripted provider that cover each behavior above, including
  a failure inside a stream, the setup notice, and a document past the
  reading limit, and keep
  [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts)
  passing while a reply streams.
* Update the service and webapp READMEs with how to run Writer with the
  scripted pair writer, and both `AGENTS.md` files with the new crate,
  endpoint, setting, and rules.
* Leave living artifacts in the reading (backlog 49, 50, and 53), the
  `Findings` tab (backlog 62) and `Reference` tab (backlog 49), threads that
  survive a reload (backlog 34), and any model (backlog 61) to later
  stories.

## Acceptance criteria

* [ ] Following the service and webapp READMEs, the maintainer runs Writer
  with the scripted pair writer and walks ADR 0012's conversation journeys
  on a synthetic document: asking about the document and a selection,
  switching and deleting threads, reviving a thread after editing,
  inspecting `What it read`, and the setup, failure, and no-document
  states.
* [ ] A writer asks for ideas to improve a synthetic document and reads a
  streamed reply whose quotes come from that document and jump to their
  passages.
* [ ] Opening another document switches `Chat` to that document's last
  thread, or a new one, and the next message reads that document.
* [ ] A document longer than the reading limit is read around the selection
  or cursor, and the composer says so before sending.
* [ ] `Stop` appears as soon as a message is sent, and stopping keeps the
  partial reply marked `Stopped`.
* [ ] A reply keeps streaming into its thread while the writer switches
  threads or collapses the pane, and arrives there unread.
* [ ] When the pair writer is not ready, the pane names what is missing and
  keeps the writer's message, and the notice clears without a reload once
  it is ready.
* [ ] No message, document, or reply text appears in a service log line or
  error response, and a test with a synthetic marker proves it.
* [ ] The browser, accessibility, and responsiveness tests pass in
  `tools/check` against the real service running the scripted provider.
* [ ] `tools/check` exits 0 without Ollama, a model, or network access to
  model providers.

## Prerequisites

None.
