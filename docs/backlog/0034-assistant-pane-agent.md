---
title: Connect the assistant pane to the pair writer
description: Replace the assistant pane's stub with the service's conversation endpoint so writers get streamed answers about the open document.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want the assistant pane to answer my messages with the pair
writer, using the document I have open, so that I can ask for ideas to
improve, develop, or explore my text without leaving the page.

## Context

Backlog 25 built the assistant pane around the `Assistant` interface in
[conversation.ts](../../webapp/src/workspace/conversation.ts), answered by a
stub that never leaves the browser.
[Backlog 12](./0012-first-pair-writing-agent.md) adds the conversation
endpoint and a fake provider for tests.
[ADR 0012](../adrs/0012-pair-writing-experience.md) decides what the `Chat`
tab shows: advice-only replies with clickable verbatim quotes, separate
named threads with a compact switcher drawer, `+ New`, and inline-confirmed
`Delete`, selection capture, `+ Context` attachments, collapsed `What it
read` disclosures, revival banners with per-turn `Text then` snapshots,
collapsed-pane unread chat signaling, and the no-provider, offline, failure,
and no-document states. The [agent ADR](./0010-agent-architecture-adr.md)
decides what context a message carries, and the
[conversations ADR](./0037-agent-conversations-adr.md) decides how
conversations and snapshots persist.
[ADR 0003](../adrs/0003-webapp-architecture.md)
consumes streamed results over SSE,
[ADR 0007](../adrs/0007-webapp-interface.md) sets the interface foundation,
and [ADR 0009](../adrs/0009-browser-tests.md) runs browser tests against a
real service.

## Scope

* Regenerate the webapp's API client from the updated contract.
* Replace the stub with an `Assistant` that calls the conversation endpoint
  and sends the open document, captured selection (cleared automatically on
  document edit or `+ New` chat), and opt-in `+ Context` document or chat
  attachments as [ADR 0012](../adrs/0012-pair-writing-experience.md) and the
  agent ADR decide.
* Show starter prompt chips for the three example requests in an empty new
  chat, stream advice-only replies with clickable verbatim quotes that
  scroll to and highlight the passage in the editor, show `Stop` immediately
  upon submit (including during the initial TTFT wait) while preventing
  double-sends, and preserve partial text marked `Stopped` if cancelled.
* Build ADR 0012's separate named thread controls inside the `Chat` tab:
  thread switcher header, inline collapsible drawer (`This document` / `All
  chats`), `+ New`, and inline-confirmed `Delete` (leaving documents
  untouched).
* Support reviving past conversations: show `Document edited since this
  chat` with `View text then` opening a read-only center-region snapshot
  view (`← Back to current draft` and `Escape`), insert a `Continuing
  against the current draft` divider when following up, and keep a per-turn
  `Text then` action on every earlier turn whose snapshot differs from the
  current draft.
* Show a collapsed `What it read` disclosure on every assistant reply
  listing sources, model, prompt version, and timing.
* Show distinct states when no provider is configured (preserving any typed
  draft and leaving writing unaffected), when offline (local Ollama active),
  when a reply fails (inline error card with `Retry` keeping the writer's
  message), and when no document is open.
* Show a quiet unread chat dot on the collapsed Assistant toggle (and a
  pulsing running dot while streaming) without opening the pane or moving
  focus, announce new replies politely to assistive technology, and keep
  every action operable from the keyboard.
* Update the assistant browser tests to run against a real service using the
  fake provider.

## Acceptance criteria

* [ ] A writer opens a synthetic document, asks for ideas to improve it, and
  reads a streamed reply that the fake provider derived from that document.
* [ ] A message sent after switching documents carries the newly open
  document.
* [ ] With no provider configured, the pane says the pair writer is not set
  up and keeps the writer's message.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Answer the writer in conversation from the service](./0012-first-pair-writing-agent.md)
