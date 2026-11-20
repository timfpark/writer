---
title: Record the webapp interface foundation ADR
description: Decide the webapp's styling, design tokens, typefaces, component primitives, drag and drop, routing, and server-state caching before the workspace shell is built.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the webapp's styling approach,
typefaces, component primitives, routing, and server-state caching decided and
accepted before the workspace shell exists so that every interface story
builds on one deliberate foundation rather than accumulating ad hoc choices.

## Context

[ADR 0003](../adrs/0003-webapp-architecture.md#application-shape) builds a
client-rendered React application and leaves routing, styling and components,
and server-state caching to the first story that needs more than one view. Its
[follow-up decisions](../adrs/0003-webapp-architecture.md#follow-up-decisions)
list them. The workspace in the [README](../../README.md#product-direction)
needs all three: a header, a navigator tree with drag and drop, a writing
surface, and an assistant pane, with both side panes collapsible.

The writing surface is the product's focus. It needs a typeface chosen for
long-form reading and writing, and a surface the text contrasts with clearly.

## Scope

* Choose a styling approach, comparing at least Tailwind CSS 4, CSS Modules
  with custom properties, and a zero-runtime CSS-in-TypeScript option such as
  vanilla-extract. Define design tokens for color, spacing, and the type scale.
* Decide theming: whether a dark theme ships in the first release, and how
  tokens make one possible if it does not.
* Choose the writing typeface and the interface typeface, with their licenses,
  self-hosted from npm packages rather than a font CDN so the webapp makes no
  third-party requests.
* Set contrast targets: WCAG 2.2 AA for the interface, and a stated higher
  target for body text on the writing surface.
* Choose headless component primitives, comparing at least React Aria
  Components and Radix UI, for the tree, menus, dialogs, and tooltips, or
  justify building them in-house.
* Choose a drag-and-drop approach for the tree, comparing at least React Aria
  drag and drop, dnd-kit, and Pragmatic drag and drop, including the
  non-dragging alternative WCAG 2.2 requires.
* Choose a router and the URL scheme, such as `/documents/{documentId}`.
* Choose server-state caching, comparing TanStack Query with direct
  openapi-fetch calls, including optimistic updates for tree changes.
* Choose the browser storage that holds a document's unacknowledged text and
  base revision across reloads, as
  [ADR 0005](../adrs/0005-workspace-model.md#presenting-saves-and-recovering)
  requires.
* Choose an icon set and state the supported browsers.
* Validate the choices with a prototype outside the repository that installs
  through the npm proxy with install scripts disabled, as ADR 0003 did.
* Amend ADR 0003's follow-up decisions, and add the ADR to the index with
  `webapp` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names each library with its starting version and the
  alternatives weighed against it.
* [ ] The ADR names the typefaces and their licenses and confirms they are
  served from the webapp's own build output.
* [ ] The ADR states the contrast targets for the interface and the writing
  surface.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
