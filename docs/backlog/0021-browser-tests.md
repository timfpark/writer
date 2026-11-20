---
title: Add browser end-to-end tests to the gate
description: Decide and add browser end-to-end and automated accessibility testing that drives the webapp against a real service with synthetic data.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
  - repository
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want browser tests that drive the webapp
against a real service so that tree editing, drag and drop, and autosave are
verified the way a writer uses them, not only in isolated components.

## Context

[ADR 0003](../adrs/0003-webapp-architecture.md#follow-up-decisions) defers
browser end-to-end and automated accessibility testing.
[ADR 0001](../adrs/0001-monorepo-structure.md#artifact-locations) defers
cross-subsystem end-to-end tests until a story needs them and leaves their
location to that story. The navigator, writing surface, and drag-and-drop
stories each need them: rich-text editing and dragging do not behave
faithfully in a simulated DOM.

## Scope

* Record an ADR choosing the browser test runner, comparing at least
  Playwright and Vitest browser mode, plus the accessibility checker, the
  browsers covered, including WebKit at iPad sizes with touch as
  [ADR 0007](../adrs/0007-webapp-interface.md#supported-browsers) requires,
  and where the tests live.
* Pin the browsers in the development container, and keep the gate runnable
  on a host.
* Start the service and the webapp's development server for each run, using
  synthetic text only. The navigator story gives each run a temporary data
  folder once the service stores the workspace.
* Add a first test of the workspace shell, including collapsing both panes,
  with an automated accessibility check.
* Run the tests in `tools/check` or a CI job wired into `CI result`, as the
  ADR decides, and update the agent guides, README, and devcontainer.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] Breaking the pane toggle makes the browser test fail, and CI reports
  `CI result` as failed.
* [ ] The tests run in the development container without network access
  beyond the registry proxies.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
