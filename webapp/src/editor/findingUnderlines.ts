import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type {
  FindingDecorationRange,
  FindingMapUpdate,
} from "../workspace/editorBridge";

let nextBlockSeq = 1;
export const allocateBlockId = (): string => `p-${nextBlockSeq++}`;

// Keeps one stable passageId per top-level block in O(changed blocks) for
// normal typing, and handles block splits/merges using ProseMirror's structural
// node sharing.
export function updateBlockIds(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  prevIds: readonly string[],
  tr: Transaction,
): { blockIds: readonly string[]; editedPassageIds: string[] } {
  const edited = new Set<string>();
  const oldCount = oldDoc.childCount;
  const newCount = newDoc.childCount;

  if (oldCount === newCount && prevIds.length === newCount) {
    const docSize = newDoc.content.size;
    for (let i = 0; i < tr.mapping.maps.length; i += 1) {
      const stepMap = tr.mapping.maps[i];
      if (!stepMap) continue;
      const tail = tr.mapping.slice(i + 1);
      stepMap.forEach((_a, _b, newStart, newEnd) => {
        if (newCount === 0) return;
        const from = Math.max(0, Math.min(docSize, tail.map(newStart, -1)));
        const to = Math.max(0, Math.min(docSize, tail.map(newEnd, 1)));
        const startIdx = Math.min(newCount - 1, newDoc.resolve(from).index(0));
        const endIdx = Math.min(newCount - 1, newDoc.resolve(to).index(0));
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const id = prevIds[idx];
          if (id) edited.add(id);
        }
      });
    }
    return { blockIds: prevIds, editedPassageIds: [...edited] };
  }

  let prefix = 0;
  while (
    prefix < oldCount &&
    prefix < newCount &&
    oldDoc.child(prefix) === newDoc.child(prefix)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldCount - prefix &&
    suffix < newCount - prefix &&
    oldDoc.child(oldCount - 1 - suffix) === newDoc.child(newCount - 1 - suffix)
  ) {
    suffix += 1;
  }

  const oldEnd = oldCount - suffix;
  const newEnd = newCount - suffix;
  for (let i = prefix; i < oldEnd; i += 1) {
    const id = prevIds[i];
    if (id) edited.add(id);
  }

  const nextIds = prevIds.slice(0, prefix);
  for (let i = 0; i < newEnd - prefix; i += 1) {
    const id =
      (i === 0 && prefix < oldEnd ? prevIds[prefix] : undefined) ??
      allocateBlockId();
    nextIds.push(id);
    edited.add(id);
  }
  for (let i = oldEnd; i < oldCount; i += 1) {
    nextIds.push(prevIds[i] ?? allocateBlockId());
  }

  return { blockIds: nextIds, editedPassageIds: [...edited] };
}

// Maps one finding's ProseMirror range through `tr` to distinguish untouched
// shifts, in-passage edits ("changed"), and passage deletions ("deleted").
export function mapFindingThroughTransaction(
  finding: FindingDecorationRange,
  tr: Transaction,
  newDoc: ProseMirrorNode,
): FindingMapUpdate {
  const innerFrom = tr.mapping.map(finding.from, 1);
  const innerTo = tr.mapping.map(finding.to, -1);

  if (innerFrom < innerTo) {
    const text = newDoc.textBetween(innerFrom, innerTo, "\n");
    if (finding.status === "active" && text === finding.quote) {
      return {
        findingId: finding.findingId,
        status: "active",
        from: innerFrom,
        to: innerTo,
      };
    }
    if (!text.trim()) {
      return { findingId: finding.findingId, status: "deleted" };
    }
    return {
      findingId: finding.findingId,
      status: "changed",
      from: innerFrom,
      to: innerTo,
    };
  }

  const outerFrom = tr.mapping.map(finding.from, -1);
  const outerTo = tr.mapping.map(finding.to, 1);
  if (
    outerFrom < outerTo &&
    newDoc.textBetween(outerFrom, outerTo, "\n").trim()
  ) {
    return {
      findingId: finding.findingId,
      status: "changed",
      from: outerFrom,
      to: outerTo,
    };
  }
  return { findingId: finding.findingId, status: "deleted" };
}

// Maps a UTF-16 code-unit range inside a ProseMirror node's plain text to
// document positions, spanning inline formatting such as emphasis or links.
export function utf16RangeInBlockToDocRange(
  node: ProseMirrorNode,
  contentStartPos: number,
  startOffset: number,
  endOffset: number,
): { from: number; to: number } | null {
  if (startOffset < 0 || endOffset <= startOffset) return null;
  let cursor = 0;
  let sep = false;
  let from: number | null = null;
  let to: number | null = null;

  node.descendants((child, pos) => {
    if (child.isTextblock) {
      if (sep) cursor += 1;
      sep = true;
      return true;
    }
    if (child.isText && child.text) {
      const start = cursor;
      const end = start + child.text.length;
      const base = contentStartPos + pos;
      if (from === null && startOffset >= start && startOffset < end) {
        from = base + (startOffset - start);
      }
      if (to === null && endOffset > start && endOffset <= end) {
        to = base + (endOffset - start);
      }
      cursor = end;
      return false;
    }
    return true;
  });

  return from !== null && to !== null && from < to ? { from, to } : null;
}
