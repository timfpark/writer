---
title: Keep chat threads across sessions in the assistant pane
description: Move the Chat tab's threads, and what each turn read, from browser memory to the service's conversation resources, so writers return to, revive, and delete conversations after a reload or restart.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want my chat threads, and the text each turn discussed, to
be there when I come back after a reload or a restart so that I can pick up
an earlier conversation, see my text as it stood then, or delete the
conversation for good.

## Context

Backlog 60 built
[ADR 0012](../adrs/0012-pair-writing-experience.md)'s `Chat` tab with its
threads, and what each turn read, held in browser memory, so a reload
clears them, and [backlog 61](./0061-local-model-chat.md) answers it from the
local model. [Backlog 12](./0012-first-pair-writing-agent.md) adds the
conversation resources the
[conversations ADR](./0037-agent-conversations-adr.md) defines. ADR 0012's
journeys 5 and 6 return to and revive earlier threads, and journey 8
deletes one permanently. [ADR 0003](../adrs/0003-webapp-architecture.md)
sets the generated client, [ADR 0007](../adrs/0007-webapp-interface.md) the
interface foundation and server-state caching, and
[ADR 0009](../adrs/0009-browser-tests.md) runs browser tests against a real
service.

## Scope

* Replace the in-memory threads with the service's conversation resources
  behind the `Assistant` interface, keeping every `Chat` behavior backlog 60
  delivers.
* Restore after a reload each document's last thread, the `Chats` list, each
  transcript with its `What it read` sources and quote links, and the dot on
  a reply that finished unseen.
* Open each turn's sources exactly as read, and show the revival banner
  with `View text then`, from what the service stored, including for a
  document renamed, moved, or deleted since.
* Keep a deleted document's threads under `All chats`, marked, as the
  navigator's delete confirmation says, and delete threads permanently
  through the service with ADR 0012's inline confirmation.
* Remove backlog 60's provisional endpoint once nothing uses it, unless the
  conversations ADR keeps it, and regenerate `service/openapi.json` and the
  webapp's client.
* Extend the browser tests to reloads and service restarts, against the
  real service running the scripted provider.

## Acceptance criteria

* [ ] After a reload and a service restart, a writer reopens an earlier
  thread, reads its transcript and `What it read` disclosures, and views the
  text each turn discussed.
* [ ] Deleting a thread removes it for good and leaves every document
  unchanged, and a deleted document's threads stay under `All chats`,
  marked, after a restart.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Keep the pair writer's conversations in the service](./0012-first-pair-writing-agent.md)
