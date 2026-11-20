---
title: Record the editor ADR
description: Decide the rich-text editing library, the supported Markdown subset and its round-trip guarantee, and how the editor feeds autosave, before the writing surface is built.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the editing library and the
Markdown it reads and writes decided and accepted before the writing surface
exists so that documents survive every save without losing or rewriting what
the writer wrote.

## Context

The [README](../../README.md#product-direction) stores documents as Markdown
and edits them in a rich-text surface that hides the markup. Its first
storage backend writes each document as a `.md` file that other tools can
read and edit, so the editor will meet Markdown it did not write.
[Backlog 11](./0011-storage-architecture-adr.md) decides whether identifiers
and sibling order live in Markdown front matter, which the editor would then
have to preserve. [ADR 0005](../adrs/0005-workspace-model.md) defines the
content format and autosave semantics on the service side; this ADR decides
the client side.

A later release adds pair-writer suggestions anchored to passages of text.
The editor must not rule that out.

## Scope

* Choose the editing library, comparing at least Tiptap on ProseMirror,
  Lexical, and Milkdown, with CodeMirror 6 as the plain-text baseline.
* Define the supported Markdown subset, such as paragraphs, headings,
  emphasis, strong emphasis, links, block quotes, lists, and horizontal rules,
  and the canonical form the editor writes.
* Decide what happens to Markdown outside the subset, so content written by
  other tools is preserved rather than dropped silently.
* Define the round-trip guarantee: loading and saving a canonical document
  without edits produces identical bytes, verified by a synthetic corpus in
  the webapp's tests.
* Decide the input rules and keyboard shortcuts, such as typing `#` and a
  space for a heading, and the undo history's scope.
* Set the autosave timing the editor drives: the idle delay, the maximum
  delay while typing continues, and the events that flush pending changes.
* Assess how the library supports decorations and ranges anchored to text,
  for later pair-writer suggestions, without building them.
* Set a bundle size budget and a responsiveness target for a long synthetic
  document.
* Add the ADR to the index with `webapp` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the library and its starting version, the alternatives
  weighed against it, and the supported Markdown subset.
* [ ] The ADR states the round-trip guarantee and the handling of
  unsupported Markdown.
* [ ] The ADR states the autosave timing and flush events.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the service storage ADR](./0011-storage-architecture-adr.md)
