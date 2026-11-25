---
title: Record the background agents UX ADR
description: Decide which background agents the pair writer runs first, from continuity and story bibles to prose and structure checks, and how each looks to the writer, with every shipping agent on from the start, tested with a throwaway prototype.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer's background agents chosen for what
helps me most, and shown in a way that fits how I write, so that they support
my writing instead of interrupting it.

## Context

The model ADR, [ADR 0010](../adrs/0010-pair-writing-models.md), measured three kinds of
background finding, suggestions, questions, and disconnects, to learn
whether local models can do background work at all. Those three were
examples, not a design. A pair writer could do much more, and some of it is
not a finding at all.

Background work takes two shapes:

* Findings: one-off notes anchored to passages, which the writer acts on or
  dismisses.
* Living artifacts: reference material the agent keeps current as the
  writer works, such as a story bible, a timeline, or a list of open
  threads, which the writer consults and can correct.

What helps depends on the work: a fantasy novel wants a story bible and
continuity checks, and a computer science book wants consistent terminology,
concepts defined before they are used, and checked code examples. The first
wave serves fiction, and the nonfiction agents (17 to 21 below) wait for
[backlog 58](./0058-nonfiction-agents.md), after writers can turn agents on
and off for parts of the workspace tree in
[backlog 54](./0054-agent-settings-tree.md). Every shipping agent starts on
for every document, so until then each must stay quiet on work it does not
apply to, such as a timeline on a technical book.

The shapes interact. Local models found contradictions across a manuscript
poorly, but extracting facts from one chapter at a time and comparing the
extracted facts may succeed where reading the whole manuscript failed.
[Backlog 56](./0056-story-bible-continuity-test.md) tests that approach
alongside this decision.

The model ADR's measurements bound each agent's cost on the reference
machine: a paragraph check takes seconds, a chapter review about 8 seconds,
and a manuscript review over a minute, at about 60 W while running. They ran
on AC power, so battery drain is an estimate this story replaces with a
measurement.

The candidate agents are:

| #  | Agent                    | What the writer gets                                                    |
|----|--------------------------|-------------------------------------------------------------------------|
| 1  | Story bible              | Characters, places, objects, and relationships, with where each appears |
| 2  | Continuity check         | Contradictions in names, ages, appearance, and facts                    |
| 3  | Timeline                 | Days, seasons, and time of day per scene, with impossible sequences     |
| 4  | Open threads             | Setups without payoffs, and payoffs without setups                      |
| 5  | Reverse outline          | A short summary of each scene, its goal, and what changes               |
| 6  | Scene purpose and pacing | Scenes where nothing changes, sagging middles, and rushed endings       |
| 7  | Weak prose               | Clichés, filler, telling instead of showing, and overwriting            |
| 8  | Repetition               | Echo words, repeated gestures, and repeated sentence openings           |
| 9  | Point of view and tense  | Head-hopping and slips in tense                                         |
| 10 | Character voice          | Dialogue that does not sound like its character                         |
| 11 | Clarity                  | Unclear speakers, ambiguous pronouns, and confusing blocking            |
| 12 | Reader reaction          | A simulated first reader's engagement, confusion, and predictions       |
| 13 | Open questions           | Questions that open directions the text has not taken                   |
| 14 | Session recap            | Where the writer left off, what changed, and a suggested next step      |
| 15 | The writer's own rules   | Checks against rules the writer sets, such as house style               |
| 16 | Anachronisms and facts   | Details wrong for the period or setting                                 |
| 17 | Terminology              | Terms used inconsistently, or defined differently in different places   |
| 18 | Concept order            | Concepts used before they are introduced or defined                     |
| 19 | Code and examples        | Code samples that do not match the text, each other, or their language  |
| 20 | Technical accuracy       | Claims to check, phrased as questions rather than corrections           |
| 21 | Cross-references         | References to chapters, figures, or sections that are missing or wrong  |

Generative work, such as alternative versions of a scene, rewrites, and
synopses, stays on request in conversation and is out of scope here.

## Scope

* For each candidate agent, decide whether it ships, is deferred, or is cut,
  and give the reason from the writer's point of view. Defer agents 17 to 21
  to backlog 58, and record what they will need from the first wave.
* For each agent that ships, decide its shape, its scope (paragraph, scene,
  chapter, or manuscript), its trigger (a pause in typing, a save, a chapter
  settling, opening Writer, or idle time), where it appears (beside the
  passage, in the assistant pane, in a view of its own, or on opening), how
  much it may interrupt.
* Decide how the writer reads, corrects, and trusts living artifacts, such as
  fixing a wrong age in the story bible, and how corrections feed the agents
  that use them.
* Decide how agents share work, such as continuity checks reading the story
  bible rather than the manuscript, so their cost fits the model ADR's
  measurements.
* Decide how each agent recognizes work it does not apply to and stays
  quiet, since every shipping agent runs on every document.
* Decide how the writer sees what is running, whether the writer can pause
  all background work and what pausing stops, and how background work slows
  on battery. Turning individual agents on and off waits for backlog 54.
* Run the check [ADR 0010](../adrs/0010-pair-writing-models.md) left open:
  the chosen models on battery with the charger unplugged, and typing in a
  browser on the host while a review runs. Record the results in ADR 0010
  and ground the battery behavior in them.
* Build a throwaway, clickable prototype with scripted outputs for the
  shipping agents, keep it out of the repository, try it while writing, and
  record what it changed. Include a workspace that holds both a novel and a
  technical book. Build it so the
  [experience ADR](./0038-pair-writing-experience-adr.md) can extend it with
  the conversation journeys rather than start another.
* Rank the shipping agents by value to the writer, so the feasibility
  measurements and delivery stories take them in order.
* State what the agents require of the experience, agent architecture, and
  conversations ADRs, such as storing living artifacts and chaining one
  agent's output into another, and revise backlog 38, 10, 37, 48, 35, 36,
  and 49 to 53 where the decision departs from them. Add a delivery story
  for any shipping agent they do not cover.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR states for every candidate agent whether it ships, is deferred,
  or is cut, and why.
* [ ] For every shipping agent, the ADR states its shape, scope, trigger,
  surface, and interruption, and ranks the agents.
* [ ] The ADR records what the prototype showed, and whether and how the
  writer pauses background work.
* [ ] ADR 0010 records the battery and typing check.
* [ ] The backlog stories that depend on it reflect the decision.
* [ ] No prototype or real manuscript is committed, and `tools/check` exits
  0.

## Prerequisites

None.
