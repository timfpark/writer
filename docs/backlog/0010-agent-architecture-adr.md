---
title: Record the pair-writing agent architecture ADR
description: Decide where the pair-writing agent runs, how it is built, and how writers work with it, both in conversation in the assistant pane and in background review of their text.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 4
---

## Story

As a contributor or coding agent, I want where the pair-writing agent runs,
and its framework, model provider, prompts, evaluations, and interaction
model, decided and accepted before any agent code exists so that the agent
stories implement a deliberate choice rather than justifying one after the
fact.

## Context

The [README](../../README.md#overview) promises an agent that is always there
with the writer: it asks questions, suggests other ideas, and checks prose
for quality and consistency. It works in two modes:

* In conversation, the writer asks in the assistant pane, for example "Give
  me some ideas about how I can improve this text", "How can I further
  develop this text?", or "What other ideas should I explore?", and the agent
  answers about the text in front of the writer.
* In background review, the agent reads the writer's text while they work
  and offers findings unprompted: suggestions to improve the text, questions
  that open other directions, and places where passages do not connect
  cleanly with each other.

[ADR 0001](../adrs/0001-monorepo-structure.md#coding-agents-and-the-product-agent)
makes the agent service behavior. It places prompts in `service/prompts/`,
model integrations in service code, and evaluation cases in
`service/evals/`. [ADR 0002](../adrs/0002-service-architecture.md) lists
"Agent framework, model providers, prompt loading, and evaluation running" as
a follow-up decision. It already requires outbound model calls on the Tokio
runtime through an async client, streaming over SSE, and an agent crate below
`writer-api` that exposes no axum, Tower, or utoipa types.
[ADR 0008](../adrs/0008-editor.md#follow-up-decisions) leaves to this
decision how the agent names passages and how its suggestions are shown and
accepted. Backlog 25 built the assistant pane around the `Assistant`
interface in [conversation.ts](../../webapp/src/workspace/conversation.ts),
answered by a stub, with the conversation held in browser memory only.

ADR 0001 rejected a separate `agent/` subsystem when the agent was expected
to answer one request at a time. Background review is long-running work
triggered by the writer's activity, and agent frameworks, provider SDKs, and
evaluation tools are more mature in Python than in Rust. The key question is
whether contributors, working with coding agents, can build and maintain in
Rust the parts of a Python agent framework that Writer needs, keeping one
service, one language, and one contract. If that is not a good bet, the
agent moves out of the Rust service and ADR 0001 and ADR 0002 change with
it.

[Backlog 12](./0012-first-pair-writing-agent.md) and
[backlog 34](./0034-assistant-pane-agent.md) build the conversation, and
[backlog 35](./0035-service-background-review.md) and
[backlog 36](./0036-background-findings-view.md) build background review, on
what this ADR decides.

## Scope

* Decide first where the agent runs, since every later choice depends on it:
  as a crate in the Rust service, as ADR 0001 and ADR 0002 assume; as a
  separate local process built on a Python or TypeScript agent framework and
  called by the service; or in the browser.
* Test the assumption the Rust option rests on. List the capabilities Writer
  needs from an agent framework, such as provider abstraction, streaming,
  structured output for findings, tool calls, retries and rate limits,
  context assembly, tracing, and an evaluation harness. For each, record
  whether a maintained Rust crate covers it or what building and maintaining
  it in Rust with coding agents would take, against adopting at least one
  established Python agent framework. Ground the comparison in throwaway
  spikes rather than estimates alone.
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
* Choose the first model provider and the async client that calls it, and
  decide how the service stays open to other providers.
* Decide how credentials and provider settings reach the service at run time,
  consistent with ADR 0001's safety rules and a sanitized `.env.example`, and
  how the service and the assistant pane behave when no provider is
  configured.
* Decide how prompts in `service/prompts/` are stored, versioned, and loaded:
  embedded at build time or read at run time.
* Decide how evaluation cases in `service/evals/` are written and run, with
  cases for each conversation request and each kind of finding, and which
  parts run in `tools/check` without credentials or network access.
* Decide how service tests and browser tests exercise the agent without a
  model provider, such as a deterministic fake provider chosen by
  configuration.
* Name the agent's responsibility and its place in ADR 0002's dependency
  direction, or the boundary between the service and a separate agent.
* Decide what context each request carries: the conversation, the open
  document, the selection, and whether other documents in the folder or
  workspace are included, since a disconnect can span documents. Decide how
  the service fits long documents into the model's context window.
* Leave to [backlog 37](./0037-agent-conversations-adr.md) how
  conversations are kept, tied to versions of the text, shown as separate
  chats, and revived or audited, and agree with it on what a request
  carries.
* Define the kinds of finding background review produces, at least
  suggestions, questions, and disconnects, and the fields each one carries.
* Decide how a finding names the passages it concerns, how those anchors
  follow the text as the writer edits, and when a finding goes stale because
  its passage changed or disappeared.
* Decide what triggers background review, such as a pause in typing or a
  save, whether the webapp or the service starts it, how reviews skip
  unchanged text and cancel when the text changes, and how model calls and
  cost are bounded per document and per hour.
* Decide how findings reach the webapp under
  [ADR 0004](../adrs/0004-api-conventions.md): returned per request, polled,
  or streamed over SSE.
* Decide how a writer dismisses a finding without it returning, and how new
  findings announce themselves without interrupting typing or moving focus.
  Backlog 37 decides whether findings appear as conversations or in a
  separate list.
* Decide how the writer turns background review on and off and its default,
  given that it sends text to a model provider without a request from the
  writer each time.
* Decide whether suggestions stay advice, or whether a writer can accept a
  proposed rewrite into the document, and if so how acceptance meets undo
  and autosave under ADR 0008.
* Resolve ADR 0008's follow-up decision on naming passages and showing
  suggestions, and link to this ADR from it.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The agent ADR is accepted and listed in the ADR index.
* [ ] The ADR states where the agent and its background reviews run, and
  records the capability-by-capability comparison of building in Rust
  against adopting a Python agent framework, with what the spikes showed.
* [ ] If the agent leaves the Rust service, ADR 0001 and ADR 0002 are
  amended in the same pull request, and backlog 12 and backlog 35 describe
  the new location.
* [ ] The ADR names the framework or direct-client approach, the first model
  provider and client, and the alternatives weighed against them.
* [ ] The ADR states how prompts load and how evaluations run, and confirms
  `tools/check` needs no credentials or network access to model providers.
* [ ] The ADR defines both modes, the context each request carries, the
  kinds of finding and how they anchor to passages,
  what triggers background review and how its cost is bounded, and how the
  writer turns it on and off.
* [ ] ADR 0008's follow-up decision on passages and suggestions links to the
  ADR.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
