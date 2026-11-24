---
title: Set the language of a document
description: Store each document's language in the workspace, let writers pick it, and mark the writing surface with it so spellcheck, hyphenation, and the pair writer follow it, starting with English and Spanish.
author: Tim Park
ms.date: 2026-11-23
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer who writes in Spanish as well as English, I want to set the
language of each document so that spellcheck, hyphenation, and the pair
writer treat my text as the language it is written in.

## Context

Writer assumes English today. The writing surface sets no `lang` attribute,
so the browser checks spelling in the system's language, and nothing in the
workspace records what language a document is in.

[ADR 0005](../adrs/0005-workspace-model.md) defines the items the workspace
holds and their fields, and keeps metadata out of a document's content.
[ADR 0006](../adrs/0006-storage-architecture.md#workspace-index) keeps
identifiers, titles, and order in the workspace index,
`.writer/workspace.json`, so a document's Markdown stays the writer's own
text. A language belongs beside them, not in front matter.
[ADR 0007](../adrs/0007-webapp-interface.md) sets the components the picker
uses, and [ADR 0008](../adrs/0008-editor.md) the writing surface the
language marks.

The pair writer will need a document's language to answer in it and to judge
its prose. [Backlog 42](./0042-spanish-pair-writing-evals.md) measures how
well the local models do that in Spanish. This story only stores and shows
the language; the agent stories decide how they use it.

Translating Writer's own interface into Spanish is a separate concern and is
out of scope.

## Scope

* Amend ADR 0005 with a document `language` field: a BCP 47 tag, starting
  with `en` and `es`, its default, and whether a folder or the workspace sets
  a default that new documents inherit. If a folder can set it, use one
  mechanism for settings that inherit down the tree with
  [backlog 54](./0054-agent-settings-tree.md), whichever lands first. Decide whether the API accepts any
  well-formed tag or only the languages Writer supports.
* Amend ADR 0006 for how the filesystem backend stores the language in the
  workspace index, and what a document created outside Writer gets.
* Return the language with each document in the workspace tree, accept it
  when a document is created, and add an operation that changes it, under
  [ADR 0004](../adrs/0004-api-conventions.md). Regenerate
  `service/openapi.json` and the webapp's API client.
* Add a keyboard-operable, accessible language picker for the open
  document, and show each language by its own name, such as "Español".
* Set `lang` on the writing surface from the document's language, so the
  browser's spellcheck and CSS hyphenation follow it, and keep the title
  field consistent with it.
* Extend the storage conformance suite, service tests, webapp tests, and
  browser tests with synthetic Spanish text, including accented characters
  and inverted punctuation.

## Acceptance criteria

* [ ] A writer can set a document to Spanish with the keyboard alone, and
  the choice survives a reload, a rename, a move, and a service restart.
* [ ] The writing surface carries `lang="es"` for a Spanish document and
  `lang="en"` for an English one.
* [ ] A document created outside Writer gets the default language, and a
  workspace index written before this story still loads.
* [ ] The document's Markdown is unchanged by setting its language.
* [ ] ADR 0005 and ADR 0006 are amended in the same pull request.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
