import type { PaneName } from "./usePane";

// Mod+\ toggles the navigator and Mod+Shift+\ the assistant, where Mod is
// Command on Apple platforms and Control elsewhere. Either modifier is
// accepted everywhere. The physical key is matched, because Shift changes
// the character it types.
export function paneForShortcut(event: KeyboardEvent): PaneName | null {
  if (
    event.repeat ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey) ||
    event.code !== "Backslash"
  ) {
    return null;
  }
  return event.shiftKey ? "assistant" : "navigator";
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(globalThis.navigator.userAgent);
}

export function shortcutLabel(pane: PaneName): string {
  const shift = pane === "assistant";
  if (isApplePlatform()) {
    return `${shift ? "⇧" : ""}⌘\\`;
  }
  return `Ctrl+${shift ? "Shift+" : ""}\\`;
}

// The aria-keyshortcuts value, listing both accepted modifiers.
export function ariaShortcut(pane: PaneName): string {
  const shift = pane === "assistant" ? "Shift+" : "";
  return `Control+${shift}\\ Meta+${shift}\\`;
}
