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
experience: advice-only replies with clickable verbatim quotes, separate
named threads, a default context of the open document and any captured
selection with opt-in `+ Context` attachments, `Stop` from the moment a
message is sent, collapsed `What it read` disclosures, per-turn snapshots
for revived threads, quiet collapsed-pane signals, and calm not-set-up,
offline, failure, and no-document states. It validated them in a throwaway
prototype kept in ignored `.local/prototype/`. This story moves them into
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
  service starts with no provider configured.
* Add a provisional, stateless streaming endpoint under ADR 0004 that takes
  the writer's message, the thread's earlier turns, the open document's
  text, an optional selection, and any opt-in attachments, and streams the
  reply as SSE events ending in `done` or `error`. Report ADR 0012's `What
  it read` metadata: provider and model, prompt name and digest when one is
  used, the sources sent, first-token and total time, and token counts.
  Regenerate `service/openapi.json` and the webapp's client.
* Make the scripted provider derive advice-only replies from the request: a
  few numbered notes, each quoting a sentence of the document or selection
  verbatim in double quotes with a brief italicized alternative. Pace them
  with a configurable first-token delay and token rate that default near
  ADR 0010's measurements (about 2 seconds and 30 tokens per second) and
  that tests shorten.
* Answer with `503` `unavailable` before the stream when no provider is
  configured, stop generating when the client disconnects, and log no
  request or reply text.
* Read the stream behind the `Assistant` interface, choosing how as
  ADR 0003 asks, and keep the conversation state in `WorkspaceShell`.
* Build ADR 0012's first journey in the `Chat` tab: starter prompts in an
  empty chat; a context chip naming the open document; a selection chip
  captured from the editor that survives focus moving to the composer and
  clears on a document edit or `+ New`; `+ Context` attachments of other
  documents and earlier threads; `Enter` to send and `Shift+Enter` for a
  new line; `Stop` from the moment of sending with no double sends; partial
  text kept and marked `Stopped`; quoted excerpts that scroll the editor to
  their passage and highlight it briefly; and a collapsed `What it read`
  disclosure on each reply.
* Hold separate named threads in browser memory with ADR 0012's switcher
  button (title and thread count), inline drawer (`This document` and `All
  chats`), `+ New`, and inline-confirmed `Delete`.
* Capture a document snapshot with each turn in memory, and show the
  revival banner with `View text then` opening a read-only snapshot in the
  center region (`← Back to current draft` and `Escape`), the `Continuing
  against the current draft` divider, and a per-turn `Text then` action.
* Signal on the collapsed `Assistant` toggle with a pulsing dot while a
  reply streams and a quiet unread dot when one finishes while `Chat` is
  hidden, announce replies politely, never open the pane or move focus,
  and keep every action operable from the keyboard.
* Show the not-set-up state (sending disabled, draft kept, writing
  unaffected), the offline note, an inline failure card with `Retry` that
  keeps the message and any partial text, and the no-document state.
* Replace the stub's browser tests with tests against the real service
  running the scripted provider that cover each behavior above, including
  a mid-stream failure and the not-set-up state, and keep
  [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts)
  passing while a reply streams.
* Update the service and webapp READMEs with how to run Writer with the
  scripted pair writer, and both `AGENTS.md` files with the new crate,
  endpoint, setting, and rules.
* Leave living artifacts in the context (backlog 49 and 50), the
  `Findings` tab (backlog 62) and `Reference` tab (backlog 49), threads that
  survive a reload (backlog 34), and any model (backlog 61) to later
  stories.

## Acceptance criteria

* [ ] Following the service and webapp READMEs, the maintainer runs Writer
  with the scripted pair writer and walks ADR 0012's conversation journeys
  on a synthetic document: asking about the document and a selection,
  switching and deleting threads, reviving a thread after editing,
  inspecting `What it read`, and the not-set-up, offline, failure, and
  no-document states.
* [ ] A writer asks for ideas to improve a synthetic document and reads a
  streamed reply whose quotes come from that document and jump to their
  passages.
* [ ] A message sent after switching documents carries the newly open
  document.
* [ ] `Stop` appears as soon as a message is sent, and stopping keeps the
  partial reply marked `Stopped`.
* [ ] With no provider configured, the pane says the pair writer is not set
  up and keeps the writer's message.
* [ ] No message, document, or reply text appears in a service log line or
  error response, and a test with a synthetic marker proves it.
* [ ] The browser, accessibility, and responsiveness tests pass in
  `tools/check` against the real service running the scripted provider.
* [ ] `tools/check` exits 0 without Ollama, a model, or network access to
  model providers.

## Prerequisites

None.
