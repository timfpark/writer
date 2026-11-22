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
endpoint and a fake provider for tests. The
[agent ADR](./0010-agent-architecture-adr.md) decides what context a message
carries, where the conversation lives, and what the pane shows when no
provider is configured. [ADR 0003](../adrs/0003-webapp-architecture.md)
consumes streamed results over SSE,
[ADR 0007](../adrs/0007-webapp-interface.md) sets the interface foundation,
and [ADR 0009](../adrs/0009-browser-tests.md) runs browser tests against a
real service.

## Scope

* Regenerate the webapp's API client from the updated contract.
* Replace the stub with an `Assistant` that calls the conversation endpoint
  and sends the open document and selection as the agent ADR decides.
* Show a reply as it streams in, keep the message box usable meanwhile, and
  let the writer stop a reply.
* Show distinct states when no provider is configured, when a reply fails,
  with a way to retry, and when no document is open.
* Keep or persist the conversation across reloads as the agent ADR decides.
* Announce new replies to assistive technology without moving focus, and keep
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
