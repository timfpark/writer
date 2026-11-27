import { createContext, useContext, useSyncExternalStore } from "react";

// Lightweight bridge between the lazily loaded DocumentEditor chunk and the
// workspace shell / assistant pane. Importing this module pulls in nothing
// from src/editor/, preserving ADR 0008's editor chunk split.

export interface EditorSelection {
  text: string;
  from: number;
  to: number;
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
}

export class EditorBridge {
  private handle: EditorHandle | null = null;
  private currentSummary: EditorSummary | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
