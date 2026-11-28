import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import type { FindingDecorationRange } from "../workspace/editorBridge";
import { editorSchema } from "./extensions";
import {
  mapFindingThroughTransaction,
  updateBlockIds,
  utf16RangeInBlockToDocRange,
} from "./findingUnderlines";
import { parseMarkdown } from "./markdown";

const schema = editorSchema();

function makeState(markdown: string) {
  const { doc } = parseMarkdown(markdown, schema);
  return EditorState.create({ doc });
}

function findingFor(
  state: EditorState,
  quote: string,
  status: "active" | "changed" = "active",
): FindingDecorationRange {
  const text = state.doc.textBetween(0, state.doc.content.size, "\n");
  const idx = text.indexOf(quote);
  if (idx === -1) throw new Error(`quote not found: ${quote}`);
  const range = utf16RangeInBlockToDocRange(
    state.doc,
    0,
    idx,
    idx + quote.length,
  );
  if (!range) throw new Error(`range not resolved: ${quote}`);
  return {
    findingId: "f-1",
    from: range.from,
    to: range.to,
    quote,
    style: "prose",
    status,
  };
}

describe("findingUnderlines mapping", () => {
  it("keeps a finding active and shifted when typing earlier in the document", () => {
    const state = makeState(
      "First paragraph.\n\nThe harbor felt very dark tonight.\n",
    );
    const finding = findingFor(state, "very dark");
    const tr = state.tr.insertText("Added words ", 1);
    const next = state.apply(tr);
    const mapped = mapFindingThroughTransaction(finding, tr, next.doc);
    expect(mapped).toEqual({
      findingId: "f-1",
      status: "active",
      from: finding.from + 12,
      to: finding.to + 12,
    });
    expect(
      next.doc.textBetween(
        mapped.status !== "deleted" ? mapped.from : 0,
        mapped.status !== "deleted" ? mapped.to : 0,
      ),
    ).toBe("very dark");
  });

  it("keeps a finding active when typing immediately before or after the quote", () => {
    const state = makeState("It was very dark outside.\n");
    const finding = findingFor(state, "very dark");

    const beforeTr = state.tr.insertText("so ", finding.from);
    const beforeState = state.apply(beforeTr);
    const beforeMapped = mapFindingThroughTransaction(
      finding,
      beforeTr,
      beforeState.doc,
    );
    expect(beforeMapped.status).toBe("active");

    const afterTr = state.tr.insertText(" and cold", finding.to);
    const afterState = state.apply(afterTr);
    const afterMapped = mapFindingThroughTransaction(
      finding,
      afterTr,
      afterState.doc,
    );
    expect(afterMapped.status).toBe("active");
  });

  it("marks a finding changed when edited inside or replaced in one transaction", () => {
    const state = makeState("It was very dark outside.\n");
    const finding = findingFor(state, "very dark");

    // Partial edit inside span.
    const partialTr = state.tr.delete(finding.to - 1, finding.to);
    const partialNext = state.apply(partialTr);
    const partialMapped = mapFindingThroughTransaction(
      finding,
      partialTr,
      partialNext.doc,
    );
    expect(partialMapped.status).toBe("changed");

    // Single-transaction replacement of exact span.
    const replaceTr = state.tr.insertText("dim", finding.from, finding.to);
    const replaceNext = state.apply(replaceTr);
    const replaceMapped = mapFindingThroughTransaction(
      finding,
      replaceTr,
      replaceNext.doc,
    );
    expect(replaceMapped.status).toBe("changed");
  });

  it("deletes a finding when its passage collapses via delete or character-by-character removal", () => {
    const state = makeState("It was very dark outside.\n");
    const finding = findingFor(state, "very dark");

    // Whole-span deletion.
    const delTr = state.tr.delete(finding.from, finding.to);
    const delNext = state.apply(delTr);
    expect(mapFindingThroughTransaction(finding, delTr, delNext.doc)).toEqual({
      findingId: "f-1",
      status: "deleted",
    });

    // Character-by-character deletion transitions to changed, then deleted once empty.
    let curState = state;
    let curFinding = finding;
    for (let i = 0; i < finding.quote.length - 1; i += 1) {
      const tr = curState.tr.delete(curFinding.to - 1, curFinding.to);
      curState = curState.apply(tr);
      const upd = mapFindingThroughTransaction(curFinding, tr, curState.doc);
      expect(upd.status).toBe("changed");
      if (upd.status === "deleted") throw new Error("unexpected early delete");
      curFinding = {
        ...curFinding,
        from: upd.from,
        to: upd.to,
        status: upd.status,
      };
    }
    const finalTr = curState.tr.delete(curFinding.from, curFinding.to);
    const finalState = curState.apply(finalTr);
    expect(
      mapFindingThroughTransaction(curFinding, finalTr, finalState.doc),
    ).toEqual({
      findingId: "f-1",
      status: "deleted",
    });
  });

  it("tracks stable passage IDs on edits and splits", () => {
    const state = makeState("First line.\n\nSecond line.\n");
    const ids = ["p-1", "p-2"];

    const editTr = state.tr.insertText(" extra", 12);
    const editNext = state.apply(editTr);
    const editRes = updateBlockIds(state.doc, editNext.doc, ids, editTr);
    expect(editRes.blockIds).toBe(ids);
    expect(editRes.editedPassageIds).toEqual(["p-1"]);

    const splitTr = state.tr.split(6);
    const splitNext = state.apply(splitTr);
    const splitRes = updateBlockIds(state.doc, splitNext.doc, ids, splitTr);
    expect(splitRes.blockIds).toHaveLength(3);
    expect(splitRes.blockIds[0]).toBe("p-1");
    expect(splitRes.blockIds[2]).toBe("p-2");
    expect(splitRes.editedPassageIds).toContain("p-1");
    expect(splitRes.editedPassageIds).toContain(splitRes.blockIds[1]);
  });

  it("maps UTF-16 ranges across inline emphasis and non-ASCII characters", () => {
    const state = makeState("Café’s pier looked *very cold* at dusk.\n");
    const block = state.doc.child(0);
    const text = block.textBetween(0, block.content.size, "\n");
    const start = text.indexOf("very cold");
    const range = utf16RangeInBlockToDocRange(
      block,
      1,
      start,
      start + "very cold".length,
    );
    expect(range).not.toBeNull();
    expect(state.doc.textBetween(range?.from ?? 0, range?.to ?? 0, "\n")).toBe(
      "very cold",
    );
  });
});
