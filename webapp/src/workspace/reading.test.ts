import { describe, expect, it } from "vitest";
import {
  buildReadingPlan,
  MAX_HISTORY_MESSAGES,
  parseReplyInline,
  READING_LIMIT_WORDS,
} from "./reading";

function makeWords(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(" ");
}

describe("reading assembly", () => {
  it("windows a document past 19,000 words around the cursor or selection", () => {
    const markdown = makeWords("w", 21_000);
    const target = "w19500";
    const offset = markdown.indexOf(target);

    const byCursor = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Long Draft",
      markdown,
      selection: null,
      cursorOffset: offset,
      contextDocuments: [],
      history: [],
    });
    expect(byCursor.documentScope).toBe("aroundCursor");
    expect(byCursor.documentWordCount).toBe(READING_LIMIT_WORDS);
    expect(byCursor.documentText).toContain(target);
    expect(byCursor.summaryLabel).toBe(
      "Long Draft · around cursor · 19,000 words",
    );

    const bySelection = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Long Draft",
      markdown,
      selection: target,
      cursorOffset: 0,
      contextDocuments: [],
      history: [],
    });
    expect(bySelection.documentScope).toBe("aroundSelection");
    expect(bySelection.documentWordCount).toBe(READING_LIMIT_WORDS);
    expect(bySelection.documentText).toContain(target);
  });

  it("drops oldest history turns first past the limit", () => {
    const markdown = makeWords("doc", 18_994);
    const plan = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Chapter 1",
      markdown,
      selection: null,
      cursorOffset: 0,
      contextDocuments: [],
      history: [
        { role: "writer", text: "oldest turn one two three four" },
        { role: "assistant", text: "middle turn five six seven" },
        { role: "writer", text: "newest one two" },
      ],
    });
    expect(plan.history).toEqual([{ role: "writer", text: "newest one two" }]);
    expect(plan.droppedHistoryTurns).toBe(2);
    expect(plan.totalWords).toBeLessThanOrEqual(READING_LIMIT_WORDS);
  });

  it("centers a repeated or formatted selection near selectionOffset", () => {
    const repeated = "She did not answer.";
    const markdown = `${repeated} earlymarker ${makeWords("mid", 25_000)} latemarker *${repeated}*`;
    const lateOffset = markdown.lastIndexOf(repeated);

    const repeatedPlan = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Long Novel",
      markdown,
      selection: repeated,
      cursorOffset: 0,
      selectionOffset: lateOffset,
      contextDocuments: [],
      history: [],
    });
    expect(repeatedPlan.documentScope).toBe("aroundSelection");
    expect(repeatedPlan.documentText).toContain("latemarker");
    expect(repeatedPlan.documentText).not.toContain("earlymarker");

    const formattedPlan = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Long Novel",
      markdown,
      selection: "latemarker She did not answer.",
      cursorOffset: 0,
      selectionOffset: lateOffset,
      contextDocuments: [],
      history: [],
    });
    expect(formattedPlan.documentScope).toBe("aroundSelection");
    expect(formattedPlan.documentText).toContain("latemarker");
    expect(formattedPlan.documentText).not.toContain("earlymarker");
  });

  it("caps history at MAX_HISTORY_MESSAGES even under the word limit", () => {
    const history: Array<{ role: "writer" | "assistant"; text: string }> =
      Array.from({ length: MAX_HISTORY_MESSAGES + 15 }, (_, i) => ({
        role: i % 2 === 0 ? "writer" : "assistant",
        text: `m${i}`,
      }));
    const plan = buildReadingPlan({
      documentId: "doc-1",
      documentTitle: "Short Draft",
      markdown: "A short sentence.",
      selection: null,
      cursorOffset: 0,
      contextDocuments: [],
      history,
    });
    expect(plan.history).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(plan.droppedHistoryTurns).toBe(15);
    expect(plan.history[0]?.text).toBe("m15");
    expect(plan.history.at(-1)?.text).toBe(`m${MAX_HISTORY_MESSAGES + 14}`);
  });

  it("parses double-quoted passages and italicized alternatives", () => {
    const segments = parseReplyInline(
      '1. In "The lamp burned low.", try *a sharper image* here.',
    );
    expect(segments).toEqual([
      { kind: "text", text: "1. In " },
      { kind: "quote", text: "The lamp burned low." },
      { kind: "text", text: ", try " },
      { kind: "italic", text: "a sharper image" },
      { kind: "text", text: " here." },
    ]);
  });
});
