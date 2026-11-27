// Pure helpers for ADR 0012's 19,000-word reading assembly and advice-only
// reply parsing (verbatim quote links and brief italicized alternatives).

import type { ChatHistoryMessage, ReadingScope } from "../api/client";

export const READING_LIMIT_WORDS = 19_000;

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
// snapped cleanly to word boundaries.
export function windowAroundOffset(
  text: string,
  focusOffset: number,
  maxWords: number,
): string {
  if (maxWords <= 0) return "";
  const spans: [number, number][] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
  }
  if (spans.length <= maxWords) return text;

  const clampedFocus = Math.max(0, Math.min(focusOffset, text.length));
  let focusWord = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span && span[0] <= clampedFocus) focusWord = i;
    else break;
  }

  const half = Math.floor(maxWords / 2);
  let startWord = Math.max(0, focusWord - half);
  let endWord = startWord + maxWords;
  if (endWord > spans.length) {
    endWord = spans.length;
    startWord = Math.max(0, endWord - maxWords);
  }
  const first = spans[startWord];
  const last = spans[endWord - 1];
  if (!first || !last) return text;
  return text.slice(first[0], last[1]);
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

// Builds ADR 0012's reading plan before a turn is sent so the composer shows
// what the next turn will read and `What it read` keeps the exact text read.
export function buildReadingPlan(input: {
  documentId: string;
  documentTitle: string;
  markdown: string;
  selection: string | null;
  cursorOffset: number;
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
      const found = input.markdown.indexOf(trimmedSelection);
      const focus = found >= 0 ? found : input.cursorOffset;
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

  // Keep the newest history turns that fit inside the remaining budget.
  const historyBudget = Math.max(0, READING_LIMIT_WORDS - usedWords);
  const keptReversed: ChatHistoryMessage[] = [];
  let historyWords = 0;
  for (let i = input.history.length - 1; i >= 0; i -= 1) {
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
