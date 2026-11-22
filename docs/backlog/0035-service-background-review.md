---
title: Review documents in the background in the service
description: Add background review that reads a document and returns suggestions, questions, and disconnects anchored to the passages they concern.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a writer, I want the pair writer to read my text while I work and come
back with suggestions to improve it, questions that open other directions,
and places where passages do not connect cleanly so that I get help I did
not think to ask for.

## Context

The [experience ADR](./0038-pair-writing-experience-adr.md) defines the kinds
of finding that ship first, from suggestions, questions, and disconnects,
and the targets for review frequency and cost. The
[agent ADR](./0010-agent-architecture-adr.md) decides how findings anchor to
passages, how reviews start, skip unchanged text, and stay within those
targets, and how findings reach the webapp.
The [conversations ADR](./0037-agent-conversations-adr.md) decides whether
each review is stored as a conversation of its own and how it points to the
version of the text it read.
[Backlog 12](./0012-first-pair-writing-agent.md) builds the agent crate,
`service/prompts/`, `service/evals/`, and the fake provider this story
extends. [ADR 0004](../adrs/0004-api-conventions.md) sets the endpoint
conventions. If building reveals a flaw in the agent ADR, amend it in the
same pull request.

## Scope

* Add the background review prompts to `service/prompts/`, starting from the
  experience ADR's trial prompts.
* Add synthetic evaluation cases for each kind of finding the experience ADR
  ships, such as suggestions grounded in the passage, questions that open a
  direction the text has not taken, and disconnects between passages.
  Include coherent documents that should produce no finding of a kind, so
  the cases catch false alarms as well as misses.
* Add the review endpoint or stream the agent ADR decides, returning findings
  with their kind, text, and passage anchors, and regenerate
  `service/openapi.json`.
* Enforce the experience ADR's frequency and cost targets in the service as
  the agent ADR decides: skip text already reviewed, and cap reviews per
  document and per period.
* Record each review and its findings as the conversations ADR decides,
  pointing to the version of the text it read.
* Record dismissed findings as the experience ADR decides so that they do
  not return for unchanged text.
* Extend the fake provider to return findings of each shipped kind.
* Extend the `service/README.md` walkthrough to review a synthetic document.

## Acceptance criteria

* [ ] Following the walkthrough with provider settings returns findings of
  each shipped kind for a synthetic document written to contain them, and
  each anchor resolves to the passage it names.
* [ ] The evaluation cases run as the agent ADR decides and include coherent
  documents that must produce no finding of a kind.
* [ ] Reviewing unchanged text again makes no model call, and a test proves
  it with the fake provider.
* [ ] No document or finding text appears in a log line or error response,
  and a test with a synthetic marker proves it.
* [ ] `tools/check` exits 0 without provider credentials or network access to
  model providers.

## Prerequisites

* [Answer the writer in conversation from the service](./0012-first-pair-writing-agent.md)
