// Pure helpers for ADR 0012's 19,000-word reading assembly and advice-only
// reply parsing (verbatim quote links and brief italicized alternatives).

import type { ChatHistoryMessage, ReadingScope } from "../api/client";

export const READING_LIMIT_WORDS = 19_000;
// Matches `MAX_HISTORY_MESSAGES` in `service/crates/writer-api/src/pair_writer.rs`.
export const MAX_HISTORY_MESSAGES = 200;

function isSpaceAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  if (code <= 32) {
    return (
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13 ||
      code === 12 ||
      code === 11
    );
  }
  return /\s/.test(text[index] ?? "");
}

export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    if (isSpaceAt(text, i)) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count += 1;
    }
  }
  return count;
}

export function formatWords(count: number): string {
  const formatted = count.toLocaleString("en-US");
  return count === 1 ? `${formatted} word` : `${formatted} words`;
}

const scopeLabels: Record<ReadingScope, string> = {
  whole: "whole",
  aroundSelection: "around selection",
  aroundCursor: "around cursor",
};

export function scopeLabel(scope: ReadingScope): string {
  return scopeLabels[scope];
}

// Extracts at most `maxWords` words centered around `focusOffset` in `text`,
// snapped cleanly to word boundaries, scanning only around `focusOffset` so a
// 1 MiB document never allocates a full-document word array.
export function windowAroundOffset(
  text: string,
  focusOffset: number,
  maxWords: number,
): string {
  if (maxWords <= 0 || !text) return "";
  const clamped = Math.max(0, Math.min(focusOffset, text.length));

  // Snap focus to the start of the word containing or following `clamped`.
  let anchor = clamped;
  while (anchor > 0 && !isSpaceAt(text, anchor - 1)) {
    anchor -= 1;
  }

  const half = Math.floor(maxWords / 2);

  // Scan up to `half` words backward from `anchor`.
  let start = anchor;
  let backCount = 0;
  let pos = anchor;
  while (pos > 0 && backCount < half) {
    while (pos > 0 && isSpaceAt(text, pos - 1)) pos -= 1;
    if (pos === 0) break;
    while (pos > 0 && !isSpaceAt(text, pos - 1)) pos -= 1;
    start = pos;
    backCount += 1;
  }

  // Scan forward from `start` until we have `maxWords` words (or reach EOF).
  let end = start;
  let forwardCount = 0;
  let i = start;
  while (i < text.length && forwardCount < maxWords) {
    while (i < text.length && isSpaceAt(text, i)) i += 1;
    if (i >= text.length) break;
    while (i < text.length && !isSpaceAt(text, i)) i += 1;
    end = i;
    forwardCount += 1;
  }

  // If we hit EOF before `maxWords`, extend backward from `start` so the
  // window still holds up to `maxWords` words near the end of the document.
  pos = start;
  while (pos > 0 && forwardCount < maxWords) {
    while (pos > 0 && isSpaceAt(text, pos - 1)) pos -= 1;
    if (pos === 0) break;
    while (pos > 0 && !isSpaceAt(text, pos - 1)) pos -= 1;
    start = pos;
    forwardCount += 1;
  }

  // Trim any leading whitespace if anchor started inside leading spaces.
  while (start < end && isSpaceAt(text, start)) start += 1;
  return text.slice(start, end);
}

export interface ContextDocEntry {
  documentId: string;
  title: string;
  markdown: string;
  wordCount: number;
}

export interface ReadingPlan {
  documentId: string;
  documentTitle: string;
  documentScope: ReadingScope;
  documentText: string;
  documentWordCount: number;
  fullDocumentWordCount: number;
  selection: string | null;
  contextDocuments: readonly ContextDocEntry[];
  history: readonly ChatHistoryMessage[];
  droppedHistoryTurns: number;
  totalWords: number;
  remainingContextWords: number;
  summaryLabel: string;
}

// Finds the occurrence of `needle` (or its first non-empty line when `needle`
// spans multiple paragraphs) in `haystack` closest to `hintOffset`.
function findNearestOccurrence(
  haystack: string,
  needle: string,
  hintOffset: number,
): number | null {
  const findBest = (target: string): number | null => {
    if (!target) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    let searchFrom = 0;
    while (searchFrom <= haystack.length) {
      const idx = haystack.indexOf(target, searchFrom);
      if (idx === -1) break;
      const dist = Math.abs(idx - hintOffset);
      if (dist < bestDist) {
        best = idx;
        bestDist = dist;
      }
      searchFrom = idx + 1;
    }
    return best;
  };

  const exact = findBest(needle);
  if (exact !== null) return exact;
  const firstLine = needle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine && firstLine !== needle) {
    return findBest(firstLine);
  }
  return null;
}

// Builds ADR 0012's reading plan before a turn is sent so the composer shows
// what the next turn will read and `What it read` keeps the exact text read.
export function buildReadingPlan(input: {
  documentId: string;
  documentTitle: string;
  markdown: string;
  selection: string | null;
  cursorOffset: number;
  selectionOffset?: number | null;
  contextDocuments: readonly ContextDocEntry[];
  history: readonly ChatHistoryMessage[];
}): ReadingPlan {
  const fullDocumentWordCount = countWords(input.markdown);
  const trimmedSelection = input.selection?.trim() || null;

  let documentScope: ReadingScope = "whole";
  let documentText = input.markdown;
  if (fullDocumentWordCount > READING_LIMIT_WORDS) {
    if (trimmedSelection) {
      documentScope = "aroundSelection";
      const hint = input.selectionOffset ?? input.cursorOffset;
      const found = findNearestOccurrence(
        input.markdown,
        trimmedSelection,
        hint,
      );
      const focus = found ?? hint;
      documentText = windowAroundOffset(
        input.markdown,
        focus,
        READING_LIMIT_WORDS,
      );
    } else {
      documentScope = "aroundCursor";
      documentText = windowAroundOffset(
        input.markdown,
        input.cursorOffset,
        READING_LIMIT_WORDS,
      );
    }
  }

  const documentWordCount = countWords(documentText);
  let usedWords = documentWordCount;

  const includedContext: ContextDocEntry[] = [];
  for (const doc of input.contextDocuments) {
    if (doc.documentId === input.documentId) continue;
    if (usedWords + doc.wordCount <= READING_LIMIT_WORDS) {
      usedWords += doc.wordCount;
      includedContext.push(doc);
    }
  }

  // Keep the newest history turns that fit inside both the word budget and the
  // service's per-request message limit.
  const historyBudget = Math.max(0, READING_LIMIT_WORDS - usedWords);
  const keptReversed: ChatHistoryMessage[] = [];
  let historyWords = 0;
  for (let i = input.history.length - 1; i >= 0; i -= 1) {
    if (keptReversed.length >= MAX_HISTORY_MESSAGES) break;
    const entry = input.history[i];
    if (!entry) continue;
    const words = countWords(entry.text);
    if (historyWords + words <= historyBudget) {
      historyWords += words;
      keptReversed.push(entry);
    } else {
      break;
    }
  }
  keptReversed.reverse();
  const droppedHistoryTurns = input.history.length - keptReversed.length;

  const totalWords = usedWords + historyWords;
  const remainingContextWords = Math.max(0, READING_LIMIT_WORDS - usedWords);
  const summaryLabel = `${input.documentTitle} · ${scopeLabel(documentScope)} · ${formatWords(documentWordCount)}`;

  return {
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    documentScope,
    documentText,
    documentWordCount,
    fullDocumentWordCount,
    selection: trimmedSelection,
    contextDocuments: includedContext,
    history: keptReversed,
    droppedHistoryTurns,
    totalWords,
    remainingContextWords,
    summaryLabel,
  };
}

export type ReplyInlineSegment =
  | { kind: "text"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "italic"; text: string };

// Splits one reply paragraph into plain text, double-quoted passages, and
// italicized alternatives so exact quotes of the current document link to
// their passages while changed quotes remain plain.
export function parseReplyInline(text: string): ReplyInlineSegment[] {
  const segments: ReplyInlineSegment[] = [];
  const pattern = /"([^"\n]+)"|\*([^*\n]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        text: text.slice(lastIndex, match.index),
      });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "quote", text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "italic", text: match[2] });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
