---
title: Record the pair-writing agent architecture ADR
description: Decide where the pair-writing agent runs and how it is built, including its framework, model provider, prompts, evaluations, and background execution, to serve the experience ADR, keeping or replacing the provisional path that backlog 60 to 62 built.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 4
---

## Story

As a contributor or coding agent, I want where the pair-writing agent runs,
and its framework, model provider, prompts, and evaluations, decided and
accepted before the agent grows past its provisional first path so that
background review and the stories after it build on a deliberate choice
that serves the writer's experience, grounded in what that path showed
rather than in whatever it happened to do.

## Context

[ADR 0012](../adrs/0012-pair-writing-experience.md)
describes how writers work with the agent, in conversation and in background
review: advice-only replies that never put agent text in the document; chat
threads that each belong to a document and record what each reply read; a
reading of the open document as it stands, unsaved edits included, up to
about 19,000 words, with the selection as its focus, plus the book's living
artifacts and documents the writer adds; background review that stops while
a reply streams and is cancelled only when an edit changes its text;
collapsed `What it read` disclosures; findings that follow edits and
reattach by exact quoted text; and targets for latency, memory, battery,
and typing grounded in [ADR 0010](../adrs/0010-pair-writing-models.md). Its
[requirements on this ADR](../adrs/0012-pair-writing-experience.md#agent-architecture-adr-backlog-10)
list what the architecture must provide.
[ADR 0011](../adrs/0011-background-agents-ux.md) picks
the fifteen Wave 1 background agents, their pause and chapter-settled
triggers, zero-cost structural quietness gates, living artifacts (story
notes, timeline, reverse outline, open threads, chapter reader reaction,
and session recaps) that downstream agents read, global Pause, and OS
power-state battery policy. [Backlog 56](./0056-story-notes-continuity-test.md)
measures whether chaining story notes into a continuity check works and
what it costs. This decision chooses an implementation that meets them.

Backlog 60,
backlog 61, and
backlog 62 came first, so writers try the
pair writer in Writer and a design that fails is backed out cheaply. Within
what ADR 0001, ADR 0002, ADR 0004, and ADR 0010 already decide, they add an
agent crate in the Rust service with a scripted provider, a stateless
streaming conversation endpoint, a direct Ollama client with the
`conversation-grounded` prompt, and a scripted review endpoint with
provisional passage anchors. They record first-token time and streaming
rate through the service, cancellation, and how the anchors mapped through
edits. This decision starts from that path and its measurements.

[ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
makes the agent service behavior. It places prompts in `service/prompts/`
and model integrations in service code, and
[ADR 0010](../adrs/0010-pair-writing-models.md), the model ADR, moves
evaluation cases, their harness, and their results into the top-level
`evals/` subsystem.
[ADR 0002](../adrs/0002-service-architecture.md) lists
"Agent framework, model providers, prompt loading, and evaluation running" as
a follow-up decision. It already requires outbound model calls on the Tokio
runtime through an async client, streaming over SSE, and an agent crate below
`writer-api` that exposes no axum, Tower, or utoipa types.
[ADR 0008](../adrs/0008-editor.md#follow-up-decisions) leaves open how the
agent names passages, which this decision settles; the experience ADR
settles how suggestions are shown and accepted.

ADR 0001 rejected a separate `agent/` subsystem when the agent was expected
to answer one request at a time. Background review is long-running work
triggered by the writer's activity, and agent frameworks, provider SDKs, and
evaluation tools are more mature in Python than in Rust. The key question is
whether contributors, working with coding agents, can build and maintain in
Rust the parts of a Python agent framework that Writer needs, keeping one
service, one language, and one contract. If that is not a good bet, the
agent moves out of the Rust service and ADR 0001 and ADR 0002 change with
it.

The [agent conversations ADR](./0037-agent-conversations-adr.md) decides how
conversations are stored. [Backlog 12](./0012-first-pair-writing-agent.md)
and [backlog 34](./0034-assistant-pane-agent.md) keep conversations across
sessions, and [backlog 35](./0035-service-background-review.md) and
[backlog 36](./0036-background-findings-view.md) build background review, on
what this ADR decides.

## Scope

* Decide first where the agent runs, since every later choice depends on it:
  as a crate in the Rust service, as ADR 0001 and ADR 0002 assume; as a
  separate local process built on a Python or TypeScript agent framework and
  called by the service; or in the browser.
* Test the assumption the Rust option rests on. List the capabilities the
  experience ADR requires from an agent framework, such as provider
  abstraction, streaming, structured output for findings, tool calls,
  retries and rate limits, context assembly, tracing, and an evaluation
  harness. For each, record whether a maintained Rust crate covers it or
  what building and maintaining it in Rust with coding agents would take,
  against adopting at least one established Python agent framework. Ground
  the comparison in the provisional path's measurements and in throwaway
  spikes rather than estimates alone.
* State which parts of the provisional path stay, change, or go: the agent
  crate and its provider interface, the HTTP client, prompt loading, the
  scripted provider that tests select, the stateless conversation and
  review endpoints, and the passage anchors.
* Weigh the cost of a second runtime: a contract between the service and the
  agent, another toolchain in the development container and `tools/check`,
  packaging for local use, and the repository rule that keeps Python tooling
  on the standard library.
* If the agent leaves the Rust service, amend ADR 0001's rejected `agent/`
  subsystem and ADR 0002's agent crate and runtime decisions, follow ADR
  0001's [Adding a subsystem](../adrs/0001-monorepo-structure.md#adding-a-subsystem)
  checklist, and revise backlog 12 and backlog 35 to move the provisional
  path and build in the new location.
* Decide where background reviews execute, as tasks on the service's Tokio
  runtime or in a separate worker, and how a review is scheduled, cancelled,
  and recovered after a restart.
* Decide how agents chain (`Story notes` and `Timeline` into `Continuity
  check` and `Character voice`; `Reverse outline` into `Scene purpose and
  pacing` and `Session recap`), how zero-cost structural quietness gates
  skip non-applicable documents, and how living artifacts update
  incrementally as chapters settle, grounded in backlog 56's measurements.
  Leave how living artifacts are stored to the
  [agent conversations ADR](./0037-agent-conversations-adr.md), and state
  what it needs from this decision.
* Within that location, choose whether to adopt an agent framework or call
  model providers directly, and compare at least two options.
* Choose the client that calls ADR 0010's
  local models through Ollama, and decide how the service stays open to
  other providers, such as a cloud model the
  [cloud fallback ADR](./0040-cloud-model-fallback-adr.md) may add later.
* Decide how Ollama's address and the chosen models reach the service at run
  time, consistent with ADR 0001's safety rules and
  a sanitized `.env.example`, and how the service reports its readiness,
  such as whether Ollama is reachable and which configured models are
  installed, so the webapp can show the experience ADR's setup notice.
* Decide how prompts in `service/prompts/` are stored, versioned, and loaded:
  embedded at build time or read at run time, and how
  [ADR 0010](../adrs/0010-pair-writing-models.md#conversation-prompt)'s
  tuned conversation prompt and
  [backlog 48](./0048-background-agent-evals.md)'s first agent prompts
  become the first versions.
* Decide how the `evals/` harness runs the agent's cases against the
  service, such as through its HTTP API, with cases for each conversation
  request and each background agent the background agents ADR ships, and
  which parts run in `tools/check` without credentials or network access.
* Decide how service tests and browser tests exercise the agent without a
  model provider, such as a deterministic fake provider chosen by
  configuration.
* Name the agent's responsibility and its place in ADR 0002's dependency
  direction, or the boundary between the service and a separate agent.
* Decide how the agent assembles [ADR 0012](../adrs/0012-pair-writing-experience.md#what-the-agent-reads)'s
  reading (the open document as it stands, or the part around the
  selection or cursor past the about 19,000-word limit, the book's living
  artifacts, added documents, and the thread's earlier turns), how it keeps
  the model's reading of unchanged text warm between turns so follow-ups
  meet ADR 0012's first-token target, how it returns the facts `What it
  read` shows and the audit record's timing and tokens, and how it maps
  failures to ADR 0004's `unavailable`, `upstreamFailed`, and
  `upstreamTimeout` codes.
* Decide how a finding names the passages it concerns so the webapp maps
  them through edits, telling an in-place edit (`Passage changed`) from a
  deletion, and reattaches them by exact quoted text in a later session or
  after the file changes outside Writer, as ADR 0012 requires. Because
  ADR 0012 keeps suggestions advice-only, nothing needs to apply agent text
  to the document.
* Decide how reviews start on [ADR 0011](../adrs/0011-background-agents-ux.md)'s
  pause, chapter-settled, and idle triggers, whether the webapp or the
  service starts them, how they skip unchanged text, enforce ADR 0011's
  per-scene and per-chapter finding density caps, stop when a chat turn
  starts and resume after its reply, cancel only when an edit changes the
  text under review or on Pause, hold a finished review's underlines until
  the next pause, read OS power and battery state from the local service
  (since Safari lacks the Web Battery API), and stay within ADR 0012's
  resource and typing targets.
* Decide how findings reach the webapp under
  [ADR 0004](../adrs/0004-api-conventions.md): returned per request, polled,
  or streamed over SSE.
* Resolve ADR 0008's follow-up decision on naming passages, and link to this
  ADR from it.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.
* Keep any prototype or spike used to inform the decision out of the
  repository, apart from the provisional path backlog 60 to 62 delivered.

## Acceptance criteria

* [ ] The agent ADR is accepted and listed in the ADR index.
* [ ] The ADR states where the agent and its background reviews run, and
  records the capability-by-capability comparison of building in Rust
  against adopting a Python agent framework, with what the provisional path
  and the spikes showed.
* [ ] The ADR states which parts of the provisional path from backlog 60 to
  62 stay, and backlog 12 and backlog 35 change the rest.
* [ ] If the agent leaves the Rust service, ADR 0001 and ADR 0002 are
  amended in the same pull request, and backlog 12 and backlog 35 describe
  the new location.
* [ ] The ADR names the framework or direct-client approach, the client for
  Ollama, and the alternatives weighed against them.
* [ ] The ADR states how prompts load and how evaluations run, and confirms
  `tools/check` needs no credentials or network access to model providers.
* [ ] The ADR states how agents chain and how living artifacts update,
  citing backlog 56.
* [ ] The ADR shows how the implementation meets each of the experience
  ADR's requirements on it and its targets for latency, memory, and
  battery.
* [ ] ADR 0008's follow-up decision on naming passages links to the ADR.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Test story notes for continuity checking](./0056-story-notes-continuity-test.md)
