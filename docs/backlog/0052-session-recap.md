---
title: Recap the last session when Writer opens
description: When the writer returns, show where they left off, what changed in their last session, and a suggested next step.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer returning to my work, I want a short recap of where I left off,
what I changed last time, and a suggested next step so that I can pick up the
thread quickly.

## Context

The [background agents ADR](./0047-background-agents-ux-adr.md) decides what
the recap holds, when it appears, and how the writer dismisses or turns it
off, and [backlog 48](./0048-background-agent-evals.md) measures it. Knowing
what changed needs a record of the last session: the change control work
from [backlog 29](./0029-service-history.md) provides history if it has
landed, and otherwise the recap uses what the service already knows, such as
which documents were saved. The pair writer from
[backlog 34](./0034-assistant-pane-agent.md) provides the agent the recap
uses.

## Scope

* Record what a session changed, as the background agents ADR decides,
  without storing more text than the workspace already holds.
* Prepare the recap in the background before the writer returns, so opening
  Writer is not delayed.
* Show the recap on opening Writer as the ADR decides, linked to the
  documents and passages it mentions, keyboard operable and accessible, and
  let the writer dismiss it or turn it off.
* Add the prompt and evaluation cases backlog 48 chose.

## Acceptance criteria

* [ ] After a synthetic session, reopening Writer shows a recap that names
  the documents changed and links to where the writer left off.
* [ ] Opening Writer is no slower with the recap on.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
