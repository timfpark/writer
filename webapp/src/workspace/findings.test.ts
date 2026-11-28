import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreatePairWriterReviewRequest,
  PairWriterReviewResponse,
  ReviewFinding,
} from "../api/client";
import type { Assistant, ReviewPassagesResult } from "./conversation";
import {
  EditorBridge,
  type EditorHandle,
  type FindingDecorationRange,
  type PassageDescriptor,
} from "./editorBridge";
import {
  applyDensityCaps,
  FindingsStore,
  hashPassageText,
  MAX_FINDINGS_PER_DOCUMENT,
  MAX_FINDINGS_PER_SCENE,
  type TrackedFinding,
} from "./findings";

function makeTracked(
  id: string,
  sceneIndex: number,
  from: number,
  to: number,
  confidence: number,
  status: "active" | "changed" = "active",
): TrackedFinding {
  return {
    findingId: id,
    documentId: "doc-1",
    passageId: `p-${sceneIndex}`,
    sceneIndex,
    agent: "weakProse",
    agentLabel: "Weak prose",
    category: "prose",
    confidence,
    note: "Note",
    quote: `quote-${id}`,
    style: "prose",
    status,
    from,
    to,
    audit: {
      model: "scripted-pair-writer",
      promptVersion: "scripted-rules-v1",
      trigger: "Short typing pause",
      reason: "Weak prose checked 1 changed paragraph.",
      sources: [],
      totalWords: 10,
    },
    sourceSnapshot: {
      documentId: "doc-1",
      title: "Doc",
      subtitle: "changed paragraph 1 · 10 words · as read",
      markdown: "text",
    },
  };
}

function makeReviewFinding(
  passageId: string,
  text: string,
  quote: string,
  id = "f-1",
  agent: ReviewFinding["agent"] = "weakProse",
): ReviewFinding {
  const start = text.indexOf(quote);
  return {
    findingId: id,
    agent,
    agentLabel: agent === "openQuestions" ? "Open questions" : "Weak prose",
    category: agent === "openQuestions" ? "questions" : "prose",
    confidence: 85,
    note: `Check “${quote}”.`,
    anchor: {
      passageId,
      contentHash: hashPassageText(text),
      startOffset: start,
      endOffset: start + quote.length,
      quote,
    },
    audit: {
      model: "scripted-pair-writer",
      promptVersion: "scripted-rules-v1",
      trigger: "Short typing pause",
      reason:
        "Weak prose checked 1 changed paragraph after a short typing pause.",
      sources: [
        {
          kind: "document",
          documentId: "doc-1",
          title: "Chapter 1",
          scope: null,
          wordCount: 8,
          label: "Chapter 1 · changed paragraph 1 · 8 words",
        },
      ],
      totalWords: 8,
    },
  };
}

function createFakeEditor(
  bridge: EditorBridge,
  passages: Map<string, PassageDescriptor>,
) {
  const syncedDecorations: Array<{
    ranges: readonly FindingDecorationRange[];
    selected: string | null;
  }> = [];
  const handle: EditorHandle = {
    documentId: "doc-1",
    readSnapshot: () => ({
      documentId: "doc-1",
      markdown: "",
      plainText: "",
      wordCount: 20,
      cursorOffset: 0,
      selectionOffset: null,
      selection: null,
      version: "r1:1",
    }),
    hasExactQuote: (quote) =>
      [...passages.values()].some((p) => p.text.includes(quote)),
    highlightQuote: () => true,
    setSelectionIgnored: () => {},
    readPassages: (ids) =>
      [...ids]
        .map((id) => passages.get(id))
        .filter((p): p is PassageDescriptor => p !== undefined),
    resolveAnchor: (anchor) => {
      const p = passages.get(anchor.passageId);
      if (!p) return null;
      const base = p.index * 100 + 1;
      return {
        from: base + anchor.startOffset,
        to: base + anchor.endOffset,
        sceneIndex: p.sceneIndex,
      };
    },
    syncFindingDecorations: (ranges, selected) => {
      syncedDecorations.push({ ranges, selected });
    },
    focusFindingRange: () => true,
  };
  const unregister = bridge.register(handle);
  return { syncedDecorations, unregister };
}

describe("applyDensityCaps", () => {
  it("enforces max 3 per scene, max 6 per document, and non-overlapping spans", () => {
    const candidates = [
      // Scene 0: 4 non-overlapping + 1 overlapping.
      makeTracked("a", 0, 1, 10, 90),
      makeTracked("overlap", 0, 5, 15, 89),
      makeTracked("b", 0, 20, 30, 88),
      makeTracked("c", 0, 40, 50, 87),
      makeTracked("d", 0, 60, 70, 86),
      // Scene 1: 3 items.
      makeTracked("e", 1, 100, 110, 85),
      makeTracked("f", 1, 120, 130, 84),
      makeTracked("g", 1, 140, 150, 83),
      // Scene 2: 2 items (exceeds chapter cap of 6).
      makeTracked("h", 2, 200, 210, 82),
      makeTracked("changed", 0, 75, 85, 50, "changed"),
    ];

    const kept = applyDensityCaps(candidates);
    const active = kept.filter((f) => f.status === "active");
    expect(active).toHaveLength(MAX_FINDINGS_PER_DOCUMENT);
    expect(active.filter((f) => f.sceneIndex === 0)).toHaveLength(
      MAX_FINDINGS_PER_SCENE,
    );
    expect(active.some((f) => f.findingId === "overlap")).toBe(false);
    expect(active.some((f) => f.findingId === "d")).toBe(false);
    expect(active.some((f) => f.findingId === "h")).toBe(false);
    // Changed cards remain until replaced or dismissed.
    expect(kept.some((f) => f.findingId === "changed")).toBe(true);
  });
});

describe("FindingsStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.localStorage.clear();
  });

  it("never starts a review during continuous typing and runs after the quiet window", async () => {
    const bridge = new EditorBridge();
    const p1Text = "The harbor felt very dark tonight.";
    const passages = new Map<string, PassageDescriptor>([
      ["p-1", { passageId: "p-1", index: 0, sceneIndex: 0, text: p1Text }],
    ]);
    createFakeEditor(bridge, passages);

    const reviewMock = vi.fn<Assistant["reviewPassages"]>(async () => ({
      ok: true,
      response: {
        model: "scripted-pair-writer",
        promptVersion: "scripted-rules-v1",
        items: [makeReviewFinding("p-1", p1Text, "very dark")],
      },
    }));
    const assistant: Assistant = {
      checkReadiness: async () => ({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
      streamReply: async () => {},
      reviewPassages: reviewMock,
    };

    const store = new FindingsStore(assistant, bridge, { pauseWindowMs: 2600 });
    store.setOpenDocument("doc-1", "Chapter 1");

    // Continuous typing every 1000 ms for 4 seconds starts no review.
    for (let i = 0; i < 4; i += 1) {
      bridge.reportTransaction({
        documentId: "doc-1",
        editedPassageIds: ["p-1"],
        findingUpdates: [],
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reviewMock).not.toHaveBeenCalled();
    }

    // Pausing past 2600 ms starts one review and populates findings.
    await vi.advanceTimersByTimeAsync(1_700);
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().activeCount).toBe(1);
    store.dispose();
  });

  it("holds underlines while typing elsewhere and cancels only when editing the reviewed passage", async () => {
    const bridge = new EditorBridge();
    const p1Text = "The harbor felt very dark tonight.";
    const p2Text = "Cold rain ticked on the dock.";
    const passages = new Map<string, PassageDescriptor>([
      ["p-1", { passageId: "p-1", index: 0, sceneIndex: 0, text: p1Text }],
      ["p-2", { passageId: "p-2", index: 1, sceneIndex: 0, text: p2Text }],
    ]);
    const { syncedDecorations } = createFakeEditor(bridge, passages);

    const pending: Array<{
      req: CreatePairWriterReviewRequest;
      signal: AbortSignal;
      resolve: (res: ReviewPassagesResult) => void;
    }> = [];

    const assistant: Assistant = {
      checkReadiness: async () => ({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
      streamReply: async () => {},
      reviewPassages: (req, signal) =>
        new Promise<ReviewPassagesResult>((resolve) => {
          pending.push({ req, signal, resolve });
        }),
    };

    const store = new FindingsStore(assistant, bridge, { pauseWindowMs: 2600 });
    store.setOpenDocument("doc-1", "Chapter 1");

    // 1. Edit p-1 and pause -> review #1 starts for p-1.
    bridge.reportTransaction({
      documentId: "doc-1",
      editedPassageIds: ["p-1"],
      findingUpdates: [],
    });
    await vi.advanceTimersByTimeAsync(2_600);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.signal.aborted).toBe(false);

    // 2. Type in p-2 while review #1 is in flight -> NOT cancelled.
    bridge.reportTransaction({
      documentId: "doc-1",
      editedPassageIds: ["p-2"],
      findingUpdates: [],
    });
    expect(pending[0]?.signal.aborted).toBe(false);

    // 3. Review #1 finishes while typing in p-2 -> underlines are HELD.
    const resp1: PairWriterReviewResponse = {
      model: "scripted-pair-writer",
      promptVersion: "scripted-rules-v1",
      items: [makeReviewFinding("p-1", p1Text, "very dark")],
    };
    pending[0]?.resolve({ ok: true, response: resp1 });
    await Promise.resolve();
    expect(store.getSnapshot().activeCount).toBe(0);
    expect(syncedDecorations).toHaveLength(0);

    // 4. Next pause flushes held underlines for p-1 and starts review #2 for p-2.
    await vi.advanceTimersByTimeAsync(2_600);
    expect(store.getSnapshot().activeCount).toBe(1);
    expect(syncedDecorations.length).toBeGreaterThan(0);
    expect(pending).toHaveLength(2);
    expect(pending[1]?.req.passages.map((p) => p.passageId)).toEqual(["p-2"]);

    // 5. Typing inside p-2 while review #2 is in flight CANCELS review #2!
    bridge.reportTransaction({
      documentId: "doc-1",
      editedPassageIds: ["p-2"],
      findingUpdates: [],
    });
    expect(pending[1]?.signal.aborted).toBe(true);
    store.dispose();
  });

  it("stops reviews while paused or while Chat is busy, and keeps Dismiss suppressed on unchanged text", async () => {
    const bridge = new EditorBridge();
    const p1Text = "The harbor felt very dark tonight.";
    const passages = new Map<string, PassageDescriptor>([
      ["p-1", { passageId: "p-1", index: 0, sceneIndex: 0, text: p1Text }],
    ]);
    createFakeEditor(bridge, passages);

    const reviewMock = vi.fn<Assistant["reviewPassages"]>(async () => ({
      ok: true,
      response: {
        model: "scripted-pair-writer",
        promptVersion: "scripted-rules-v1",
        items: [makeReviewFinding("p-1", p1Text, "very dark")],
      },
    }));
    const assistant: Assistant = {
      checkReadiness: async () => ({
        ready: true,
        provider: "scripted",
        model: "scripted-pair-writer",
        issue: null,
        detail: null,
      }),
      streamReply: async () => {},
      reviewPassages: reviewMock,
    };

    const store = new FindingsStore(assistant, bridge, { pauseWindowMs: 2600 });
    store.setOpenDocument("doc-1", "Chapter 1");

    // Paused sends zero reviews.
    store.setPaused(true);
    bridge.reportTransaction({
      documentId: "doc-1",
      editedPassageIds: ["p-1"],
      findingUpdates: [],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reviewMock).not.toHaveBeenCalled();

    // Chat busy blocks reviews even after resume.
    store.setChatBusy(true);
    store.setPaused(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reviewMock).not.toHaveBeenCalled();

    // Chat finishes -> pause review runs -> dismiss suppresses unchanged text.
    store.setChatBusy(false);
    await vi.advanceTimersByTimeAsync(2_600);
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().activeCount).toBe(1);

    store.dismissFinding("f-1");
    expect(store.getSnapshot().activeCount).toBe(0);

    // Edit outside the dismissed quote in the same passage -> still suppressed.
    const updatedText = "The harbor felt very dark tonight indeed.";
    passages.set("p-1", {
      passageId: "p-1",
      index: 0,
      sceneIndex: 0,
      text: updatedText,
    });
    reviewMock.mockResolvedValueOnce({
      ok: true,
      response: {
        model: "scripted-pair-writer",
        promptVersion: "scripted-rules-v1",
        items: [makeReviewFinding("p-1", updatedText, "very dark")],
      },
    });
    bridge.reportTransaction({
      documentId: "doc-1",
      editedPassageIds: ["p-1"],
      findingUpdates: [],
    });
    await vi.advanceTimersByTimeAsync(2_600);
    expect(reviewMock).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().activeCount).toBe(0);
    store.dispose();
  });
});
