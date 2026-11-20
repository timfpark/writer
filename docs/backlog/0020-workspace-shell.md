---
title: Build the workspace shell
description: Replace the foundation page with the header, collapsible navigator and assistant panes, and a central writing region, on the styling and routing foundation ADR 0016 records.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want a calm workspace with a header, a navigator on the left,
an assistant on the right, and the writing region in the center, with both
side panes collapsible, so that I can give the full width of the screen to my
writing whenever I choose.

## Context

The [README](../../README.md#the-writing-workspace) describes the layout.
[Backlog 16](./0016-webapp-interface-adr.md) chooses the styling, tokens,
typefaces, primitives, router, and server-state caching this story installs.
[Backlog 7](./0007-webapp-foundation.md) leaves a single page showing service
health. Later stories fill the regions: the navigator in
[backlog 22](./0022-workspace-navigator.md), the writing surface in
[backlog 23](./0023-writing-surface.md), and the assistant in
[backlog 25](./0025-assistant-pane.md).

## Scope

* Install the packages backlog 16 chooses, and add the design tokens, global
  styles, and self-hosted typefaces.
* Lay out a header bar above three regions. The central writing region takes
  every pixel the side panes do not use.
* Put a title slot on the left of the header, pane toggles, and a placeholder
  profile avatar and menu on the right for the one local user, with no
  authentication.
* Collapse and expand each side pane from the header and with keyboard
  shortcuts, and remember each pane's state across reloads in browser
  storage.
* On narrow viewports, show side panes over the writing region rather than
  narrowing it.
* Add the routes for the empty workspace and for an open document, and show
  a clear message when the service is unreachable in place of the health page.
* Update `webapp/README.md` and `webapp/AGENTS.md` with the new dependencies
  and structure.

## Acceptance criteria

* [ ] With both side panes collapsed, the writing region spans the full
  width below the header.
* [ ] Each pane's collapsed state survives a reload.
* [ ] Every header control is reachable by keyboard and has an accessible
  name.
* [ ] The webapp makes no request to a host other than its own origin.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Establish the webapp subsystem foundation](./0007-webapp-foundation.md)
* [Record the webapp interface foundation ADR](./0016-webapp-interface-adr.md)
