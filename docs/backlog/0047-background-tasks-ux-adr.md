---
title: Record the background tasks UX ADR
description: Decide which background agents the pair writer offers, from continuity and story bibles to prose, structure, and nonfiction checks, how each looks to the writer, and how writers turn agents on and off for parts of the workspace tree, tested with a throwaway prototype.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a writer, I want the pair writer's background work chosen for what helps
me most, shown in a way that fits how I write, and switched on only where it
suits the work, so that it supports my writing instead of interrupting it.

## Context

The [model ADR](./0039-pair-writing-model-adr.md) measured three kinds of
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

Each task runs as an agent the writer can turn on or off. What helps depends
on the work: a fantasy novel wants a story bible and continuity checks, and a
computer science book wants consistent terminology, concepts defined before
they are used, and checked code examples. A workspace may hold both, so the
set of agents in effect belongs to a place in the workspace tree. A folder's
setting applies to everything under it, and a subfolder or document can turn
an agent on or off for itself, so the agents in effect for any document, and
where each setting comes from, can always be worked out.

The shapes interact. Local models found contradictions across a manuscript
poorly, but extracting facts from one chapter at a time and comparing the
extracted facts may succeed where reading the whole manuscript failed.

The model ADR's measurements bound each task's cost on the reference
machine: a paragraph check takes seconds, a chapter review about 8 seconds,
and a manuscript review over a minute, at about 60 W while running.

The candidate tasks are:

| #  | Task                     | What the writer gets                                                    |
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

* For each candidate task, decide whether it ships, is deferred, or is cut,
  and give the reason from the writer's point of view.
* For each task that ships, decide its shape, its scope (paragraph, scene,
  chapter, or manuscript), its trigger (a pause in typing, a save, a chapter
  settling, opening Writer, or idle time), where it appears (beside the
  passage, in the assistant pane, in a view of its own, or on opening), how
  much it may interrupt, and whether it is on by default.
* Decide how the writer reads, corrects, and trusts living artifacts, such as
  fixing a wrong age in the story bible, and how corrections feed the tasks
  that use them.
* Decide how tasks share work, such as continuity checks reading the story
  bible rather than the manuscript, so their cost fits the model ADR's
  measurements.
* Decide how agents are turned on and off across the workspace tree: where a
  setting can be made (the workspace, a folder, or a document), how a
  setting inherits to everything below it, how a lower setting overrides a
  higher one, and how the writer sees the agents in effect for a document and
  where each setting comes from.
* Decide whether presets bundle agents for a kind of work, such as fiction or
  technical nonfiction, what each preset holds, and whether a preset is
  applied once or stays linked.
* Decide how settings an agent has beyond on and off, such as the writer's
  own rules, are scoped, and whether they inherit the same way.
* Decide how the writer sees what is running and limits background work on
  battery.
* Build a throwaway, clickable prototype with scripted outputs for the
  shipping tasks, keep it out of the repository, try it while writing, and
  record what it changed. Include a workspace that holds both a novel and a
  technical book.
* Rank the shipping tasks by value to the writer, so the feasibility
  measurements and delivery stories take them in order.
* State what the tasks require of the experience, agent architecture, and
  conversations ADRs, such as storing living artifacts, and revise backlog
  38, 10, 37, 35, 36, and 49 to 54 where the decision departs from them.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR states for every candidate task whether it ships, is deferred,
  or is cut, and why.
* [ ] For every shipping task, the ADR states its shape, scope, trigger,
  surface, interruption, and default, and ranks the tasks.
* [ ] The ADR states how agents are turned on and off across the workspace
  tree, how settings inherit and override, and any presets.
* [ ] The ADR records what the prototype showed.
* [ ] The backlog stories that depend on it reflect the decision.
* [ ] No prototype or real manuscript is committed, and `tools/check` exits
  0.

## Prerequisites

* [Record the pair-writing model ADR](./0039-pair-writing-model-adr.md)
