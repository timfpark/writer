---
title: Prototype the assistant pane
description: Fill the right pane with a conversation transcript and a message box answered by a client-side stub, behind a boundary the pair-writing agent can replace.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to see where I will talk with the pair writer so that the
workspace's shape is settled before the agent exists.

## Context

The [README](../../README.md#the-writing-workspace) makes the right pane the
main way the writer and the AI interact. The agent itself arrives with
[backlog 10](./0010-agent-architecture-adr.md) and
[backlog 12](./0012-first-pair-writing-agent.md). Until then the pane is a
mechanical prototype, and effort stays small.
[Backlog 20](./0020-workspace-shell.md) provides the collapsible pane.

## Scope

* Show a scrolling transcript of the writer's and the assistant's messages,
  keeping the newest in view.
* Add a multi-line message box: `Enter` sends and `Shift+Enter` starts a new
  line.
* Answer each message with a client-side stub that states the assistant is
  not connected yet.
* Keep the conversation in memory only. It is not sent to the service or
  saved, and a reload clears it.
* Put the stub behind one interface that a later story replaces with calls to
  the service.
* Add component tests for sending and receiving.

## Acceptance criteria

* [ ] Sending a message shows it and the stub reply in the transcript.
* [ ] The webapp sends no request when a message is sent.
* [ ] Collapsing and expanding the pane keeps the transcript.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Build the workspace shell](./0020-workspace-shell.md)
