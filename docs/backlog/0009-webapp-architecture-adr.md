---
title: Record the webapp architecture ADR
description: Decide the webapp's build tool, API client generator, and development server port before webapp/ is built.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want the webapp's core architecture
decided and accepted before any webapp code exists so that the webapp
foundation implements a deliberate choice rather than justifying one after the
fact.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md) requires the webapp to call the
service only through a client generated from the service's committed OpenAPI
document. It leaves the build tool and generator to a later webapp ADR.
[ADR 0002](../adrs/0002-service-architecture.md) emits that document from
service code as OpenAPI 3.1 JSON at `service/openapi.json`, so the generator
must read OpenAPI 3.1. ADR 0002 also leaves cross-origin access to this
decision. [Backlog 7](./0007-webapp-foundation.md) builds what this ADR
decides.

## Scope

* Choose the build tool and compare it with at least one alternative.
* Choose the API client generator, confirming it reads OpenAPI 3.1 and
  recording whether it reads OpenAPI 3.2, which ADR 0002 names as a revisit
  trigger.
* Choose the development server port, and decide whether the development
  server proxies requests to the service or the service allows the webapp's
  origin.
* Add the ADR to the ADR index with `webapp` in its `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The webapp ADR is accepted and listed in the ADR index.
* [ ] The ADR names the build tool, the client generator, and the development
  server port, and records the alternatives weighed against them.
* [ ] The ADR confirms the generator reads OpenAPI 3.1, the version ADR 0002
  selects.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
