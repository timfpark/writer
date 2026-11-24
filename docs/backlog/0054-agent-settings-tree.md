---
title: Turn background agents on and off across the workspace tree
description: After writers have used background agents that are always on, decide and build how agents are turned on and off at the workspace, folder, and document level, resolved by inheritance, with presets for kinds of work.
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

The [background agents ADR](./0047-background-agents-ux-adr.md) starts every
shipping agent on for every document, and asks each agent to stay quiet on
work it does not apply to. Background review from
[backlog 35](./0035-service-background-review.md) runs the first agents,
[backlog 36](./0036-background-findings-view.md) shows their findings, and
backlog 49 to 53 add more. This story follows them, so the case for turning
agents off rests on which agents writers found unhelpful for which kinds of
work.

[ADR 0005](../adrs/0005-workspace-model.md) defines the items in the tree,
and [ADR 0006](../adrs/0006-storage-architecture.md#workspace-index) keeps
their metadata in the workspace index. A document's language, from
[backlog 41](./0041-document-language.md), may also be set on a folder and
inherited; both should use one mechanism for settings that inherit down the
tree, whichever story lands first.

## Scope

* Decide, and record as an amendment to the background agents ADR, how
  agents are turned on and off across the workspace tree: where a setting
  can be made (the workspace, a folder, or a document), how it inherits to
  everything below, how a lower setting overrides a higher one, and whether
  presets bundle agents for a kind of work, such as fiction or technical
  nonfiction. Decide whether agent options, such as the writer's own rules
  from backlog 53, are scoped the same way.
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
  accessible. Apply presets if the decision includes them.
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
* [ ] The background agents ADR, ADR 0005, and ADR 0006 are amended in the
  same pull request.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
* [Keep a story bible and check continuity](./0049-story-bible-continuity.md)
* [Review finished chapters](./0051-chapter-review.md)
