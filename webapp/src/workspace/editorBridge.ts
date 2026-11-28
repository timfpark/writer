import { createContext, useContext, useSyncExternalStore } from "react";

// Lightweight bridge between the lazily loaded DocumentEditor chunk and the
// workspace shell / assistant pane. Importing this module pulls in nothing
// from src/editor/, preserving ADR 0008's editor chunk split.

export interface EditorSelection {
  text: string;
  from: number;
  to: number;
}

export interface PassageDescriptor {
  passageId: string;
  index: number;
  sceneIndex: number;
  text: string;
}

export type FindingUnderlineStyle = "prose" | "question";

export interface FindingDecorationRange {
  findingId: string;
  from: number;
  to: number;
  quote: string;
  style: FindingUnderlineStyle;
  status: "active" | "changed";
}

export type FindingMapUpdate =
  | {
      findingId: string;
      status: "active" | "changed";
      from: number;
      to: number;
    }
  | {
      findingId: string;
      status: "deleted";
    };

export interface EditorTransactionReport {
  documentId: string;
  editedPassageIds: readonly string[];
  findingUpdates: readonly FindingMapUpdate[];
}

export interface ResolvedFindingAnchor {
  from: number;
  to: number;
  sceneIndex: number;
}

export interface DocumentSnapshot {
  documentId: string;
  markdown: string;
  plainText: string;
  wordCount: number;
  // Offsets in `markdown` character coordinates for windowing long documents.
  cursorOffset: number;
  selectionOffset: number | null;
  selection: EditorSelection | null;
  version: string;
}

export interface EditorSummary {
  documentId: string;
  wordCount: number;
  cursorOffset: number;
  selection: EditorSelection | null;
  // Changes on revision change or after debounced edits so Chat can re-check
  // exact quote links and the "Document edited since this chat" banner
  // without serializing on every keystroke.
  version: string;
}

export interface EditorHandle {
  documentId: string;
  readSnapshot(): DocumentSnapshot;
  hasExactQuote(quote: string): boolean;
  highlightQuote(quote: string): boolean;
  setSelectionIgnored(ignored: boolean): void;
  readPassages(passageIds: ReadonlySet<string>): PassageDescriptor[];
  resolveAnchor(anchor: {
    passageId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
  }): ResolvedFindingAnchor | null;
  syncFindingDecorations(
    ranges: readonly FindingDecorationRange[],
    selectedFindingId: string | null,
  ): void;
  focusFindingRange(from: number, to: number, moveCaret: boolean): boolean;
}

export class EditorBridge {
  private handle: EditorHandle | null = null;
  private currentSummary: EditorSummary | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly transactionListeners = new Set<
    (report: EditorTransactionReport) => void
  >();
  private readonly findingClickListeners = new Set<
    (documentId: string, findingId: string) => void
  >();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onTransaction = (
    listener: (report: EditorTransactionReport) => void,
  ): (() => void) => {
    this.transactionListeners.add(listener);
    return () => this.transactionListeners.delete(listener);
  };

  onFindingClick = (
    listener: (documentId: string, findingId: string) => void,
  ): (() => void) => {
    this.findingClickListeners.add(listener);
    return () => this.findingClickListeners.delete(listener);
  };

  get summary(): EditorSummary | null {
    return this.currentSummary;
  }

  get activeHandle(): EditorHandle | null {
    return this.handle;
  }

  register(handle: EditorHandle, initial?: EditorSummary): () => void {
    this.handle = handle;
    if (initial) {
      this.currentSummary = initial;
      this.emit();
    }
    return () => {
      if (this.handle !== handle) return;
      this.handle = null;
      this.currentSummary = null;
      this.emit();
    };
  }

  updateSummary(next: EditorSummary): void {
    if (this.handle?.documentId !== next.documentId) return;
    const prev = this.currentSummary;
    if (
      prev &&
      prev.documentId === next.documentId &&
      prev.wordCount === next.wordCount &&
      prev.cursorOffset === next.cursorOffset &&
      prev.version === next.version &&
      prev.selection?.text === next.selection?.text &&
      prev.selection?.from === next.selection?.from &&
      prev.selection?.to === next.selection?.to
    ) {
      return;
    }
    this.currentSummary = next;
    this.emit();
  }

  reportTransaction(report: EditorTransactionReport): void {
    if (this.handle?.documentId !== report.documentId) return;
    for (const listener of this.transactionListeners) listener(report);
  }

  reportFindingClick(documentId: string, findingId: string): void {
    if (this.handle?.documentId !== documentId) return;
    for (const listener of this.findingClickListeners) {
      listener(documentId, findingId);
    }
  }

  readSnapshot(documentId: string): DocumentSnapshot | null {
    if (this.handle?.documentId !== documentId) return null;
    return this.handle.readSnapshot();
  }

  hasExactQuote(documentId: string, quote: string): boolean {
    if (this.handle?.documentId !== documentId) return false;
    return this.handle.hasExactQuote(quote);
  }

  highlightQuote(documentId: string, quote: string): boolean {
    if (this.handle?.documentId !== documentId) return false;
    return this.handle.highlightQuote(quote);
  }

  setSelectionIgnored(documentId: string, ignored: boolean): void {
    if (this.handle?.documentId !== documentId) return;
    this.handle.setSelectionIgnored(ignored);
  }

  readPassages(
    documentId: string,
    passageIds: ReadonlySet<string>,
  ): PassageDescriptor[] {
    if (this.handle?.documentId !== documentId) return [];
    return this.handle.readPassages(passageIds);
  }

  resolveAnchor(
    documentId: string,
    anchor: {
      passageId: string;
      startOffset: number;
      endOffset: number;
      quote: string;
    },
  ): ResolvedFindingAnchor | null {
    if (this.handle?.documentId !== documentId) return null;
    return this.handle.resolveAnchor(anchor);
  }

  syncFindingDecorations(
    documentId: string,
    ranges: readonly FindingDecorationRange[],
    selectedFindingId: string | null,
  ): void {
    if (this.handle?.documentId !== documentId) return;
    this.handle.syncFindingDecorations(ranges, selectedFindingId);
  }

  focusFindingRange(
    documentId: string,
    from: number,
    to: number,
    moveCaret: boolean,
  ): boolean {
    if (this.handle?.documentId !== documentId) return false;
    return this.handle.focusFindingRange(from, to, moveCaret);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const EditorBridgeContext = createContext<EditorBridge>(
  new EditorBridge(),
);

export function useEditorBridge(): EditorBridge {
  return useContext(EditorBridgeContext);
}

export function useEditorSummary(): EditorSummary | null {
  const bridge = useEditorBridge();
  return useSyncExternalStore(bridge.subscribe, () => bridge.summary);
}
