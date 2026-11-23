---
title: Record the pair-writing agent architecture ADR
description: Decide where the pair-writing agent runs and how it is built, including its framework, model provider, prompts, evaluations, and background execution, to serve the experience ADR.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want where the pair-writing agent runs,
and its framework, model provider, prompts, and evaluations, decided and
accepted before any agent code exists so that the agent stories implement a
deliberate choice that serves the writer's experience rather than justifying
one after the fact.

## Context

The [pair-writing experience ADR](./0038-pair-writing-experience-adr.md)
describes how writers work with the agent, in conversation and in background
review. It defines the kinds of finding, what the agent pays attention to,
when reviews run, and the targets for latency, review frequency, memory, and battery.
This decision chooses an implementation that meets them.

[ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
makes the agent service behavior. It places prompts in `service/prompts/`
and model integrations in service code, and the
[model ADR](./0039-pair-writing-model-adr.md) moves evaluation cases, their
harness, and their results into the top-level `evals/` subsystem.
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
and [backlog 34](./0034-assistant-pane-agent.md) build the conversation, and
[backlog 35](./0035-service-background-review.md) and
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
  the comparison in throwaway spikes rather than estimates alone.
* Weigh the cost of a second runtime: a contract between the service and the
  agent, another toolchain in the development container and `tools/check`,
  packaging for local use, and the repository rule that keeps Python tooling
  on the standard library.
* If the agent leaves the Rust service, amend ADR 0001's rejected `agent/`
  subsystem and ADR 0002's agent crate and runtime decisions, follow ADR
  0001's [Adding a subsystem](../adrs/0001-monorepo-structure.md#adding-a-subsystem)
  checklist, and revise backlog 12 and backlog 35 to build in the new
  location.
* Decide where background reviews execute, as tasks on the service's Tokio
  runtime or in a separate worker, and how a review is scheduled, cancelled,
  and recovered after a restart.
* Within that location, choose whether to adopt an agent framework or call
  model providers directly, and compare at least two options.
* Choose the client that calls the [model ADR](./0039-pair-writing-model-adr.md)'s
  local models through Ollama, and decide how the service stays open to
  other providers, such as a cloud model the
  [cloud fallback ADR](./0040-cloud-model-fallback-adr.md) may add later.
* Decide how Ollama's address and the chosen models reach the service at run
  time, consistent with ADR 0001's safety rules and
  a sanitized `.env.example`, and how the service reports a missing or
  unreachable model so the webapp can show the experience ADR's no-provider
  state.
* Decide how prompts in `service/prompts/` are stored, versioned, and loaded:
  embedded at build time or read at run time, and how the experience ADR's
  trial prompts become the first versions.
* Decide how the `evals/` harness runs the agent's cases against the
  service, such as through its HTTP API, with cases for each conversation
  request and each kind of finding the experience ADR ships, and which parts run in `tools/check` without
  credentials or network access.
* Decide how service tests and browser tests exercise the agent without a
  model provider, such as a deterministic fake provider chosen by
  configuration.
* Name the agent's responsibility and its place in ADR 0002's dependency
  direction, or the boundary between the service and a separate agent.
* Decide how the agent assembles what the experience ADR says it pays
  attention to into each request, and how it fits long documents and
  several documents into the model's context window.
* Decide how a finding names the passages it concerns and how those anchors
  follow the text as the writer edits, so the webapp can show the experience
  ADR's behavior for edited and deleted passages.
* Decide how reviews start on the experience ADR's triggers, whether the
  webapp or the service starts them, how they skip unchanged text and cancel
  when the text changes, and how they stay within its frequency and resource
  targets.
* Decide how findings reach the webapp under
  [ADR 0004](../adrs/0004-api-conventions.md): returned per request, polled,
  or streamed over SSE.
* If the experience ADR lets writers accept rewrites, decide how an accepted
  rewrite applies to the document under ADR 0008's undo and autosave.
* Resolve ADR 0008's follow-up decision on naming passages, and link to this
  ADR from it.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.
* Keep any prototype or spike used to inform the decision out of the
  repository.

## Acceptance criteria

* [ ] The agent ADR is accepted and listed in the ADR index.
* [ ] The ADR states where the agent and its background reviews run, and
  records the capability-by-capability comparison of building in Rust
  against adopting a Python agent framework, with what the spikes showed.
* [ ] If the agent leaves the Rust service, ADR 0001 and ADR 0002 are
  amended in the same pull request, and backlog 12 and backlog 35 describe
  the new location.
* [ ] The ADR names the framework or direct-client approach, the client for
  Ollama, and the alternatives weighed against them.
* [ ] The ADR states how prompts load and how evaluations run, and confirms
  `tools/check` needs no credentials or network access to model providers.
* [ ] The ADR shows how the implementation meets each of the experience
  ADR's targets for latency, review frequency, memory, and battery.
* [ ] ADR 0008's follow-up decision on naming passages links to the ADR.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the pair-writing experience ADR](./0038-pair-writing-experience-adr.md)
* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
