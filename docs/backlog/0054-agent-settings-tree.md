---
title: Turn background agents on and off across the workspace tree
description: Store which background agents are on or off at the workspace, folder, and document level, resolve the agents in effect for each document by inheritance, and let writers see and change them.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer whose workspace holds different kinds of work, such as a fantasy
novel and a computer science book, I want to choose which background agents
run for each part of my workspace so that each piece of writing gets the
help that suits it and nothing else.

## Context

The [background tasks ADR](./0047-background-tasks-ux-adr.md) decides how
agents are turned on and off across the workspace tree: where settings can
be made, how they inherit and override, how the writer sees the agents in
effect and where each setting comes from, and any presets for kinds of work.
Background review from [backlog 35](./0035-service-background-review.md) runs
the first agents, and [backlog 36](./0036-background-findings-view.md) shows
their findings. Backlog 49 to 53 add more agents, each of which this
mechanism turns on and off.

[ADR 0005](../adrs/0005-workspace-model.md) defines the items in the tree,
and [ADR 0006](../adrs/0006-storage-architecture.md#workspace-index) keeps
their metadata in the workspace index. A document's language, from
[backlog 41](./0041-document-language.md), may also be set on a folder and
inherited; both should use one mechanism for settings that inherit down the
tree, whichever story lands first.

## Scope

* Amend ADR 0005 with agent settings on the workspace, folders, and
  documents, and the rule that resolves the agents in effect for a document,
  and amend ADR 0006 for how the index stores them. Keep the settings when an
  item is moved, and decide whether a moved item keeps its own settings
  while inheriting from its new parent.
* Resolve the agents in effect in `writer-domain`, so every backend and the
  API agree, and test it with a deep tree, overrides at several levels, and
  moves.
* Return each item's own settings and each document's agents in effect, with
  the item each setting comes from, and accept changes, under
  [ADR 0004](../adrs/0004-api-conventions.md). Regenerate
  `service/openapi.json` and the webapp's API client.
* Make background review run only the agents in effect for a document, and
  stop an agent's work on a document when it is turned off there.
* Show the agents in effect for the open document and for a folder, with
  where each setting comes from, and let the writer turn an agent on or off
  at that level or return it to inheriting, keyboard operable and
  accessible. Apply presets if the ADR decides on them.
* Extend the storage conformance suite, service tests, webapp tests, and
  browser tests.

## Acceptance criteria

* [ ] Turning an agent off on a folder stops it for every document beneath,
  except a subfolder or document that turns it back on.
* [ ] For any document, the webapp shows which agents are in effect and the
  item each setting comes from.
* [ ] Settings survive a reload, a rename, a move as the ADR decides, and a
  service restart, and a workspace index written before this story still
  loads.
* [ ] An agent turned off for a document makes no model calls for it, and a
  test proves it with the fake provider.
* [ ] ADR 0005 and ADR 0006 are amended in the same pull request.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
