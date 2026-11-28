import type { PaneName } from "./usePane";

// A key combination: modifiers, then the key's KeyboardEvent.key value. Mod
// is Command on Apple platforms and Control elsewhere.
export type Keys = readonly string[];

export const paneKeys: Record<PaneName, Keys> = {
  navigator: ["Mod", "\\"],
  assistant: ["Mod", "Shift", "\\"],
};

export const referenceKeys: Keys = ["Mod", "/"];

export const pauseKeys: Keys = ["Mod", "Shift", "P"];

function hasMod(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

// Mod+\ toggles the navigator and Mod+Shift+\ the assistant. Either
// modifier is accepted everywhere. The physical key is matched, because
// Shift changes the character it types.
export function paneForShortcut(event: KeyboardEvent): PaneName | null {
  if (
    event.repeat ||
    event.altKey ||
    !hasMod(event) ||
    event.code !== "Backslash"
  ) {
    return null;
  }
  return event.shiftKey ? "assistant" : "navigator";
}

// F6 moves focus to the next pane and Shift+F6 to the previous one.
export function regionStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key !== "F6" || event.altKey || hasMod(event)) return null;
  return event.shiftKey ? -1 : 1;
}

// Mod+/ shows the shortcut reference, matched by physical key as above.
export function isReferenceShortcut(event: KeyboardEvent): boolean {
  return (
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    hasMod(event) &&
    event.code === "Slash"
  );
}

// Mod+Shift+P pauses or resumes background review.
export function isPauseShortcut(event: KeyboardEvent): boolean {
  return (
    !event.repeat &&
    !event.altKey &&
    event.shiftKey &&
    hasMod(event) &&
    event.code === "KeyP"
  );
}

// F8 moves to the next finding and Shift+F8 to the previous one.
export function findingStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key !== "F8" || event.altKey || hasMod(event)) return null;
  return event.shiftKey ? -1 : 1;
}

export type NavigatorShortcut =
  "rename" | "delete" | "menu" | "moveUp" | "moveDown";

// The navigator's keys for its focused row. Mod+Backspace deletes too, as
// in the macOS Finder, because most Apple keyboards lack a Delete key.
export function navigatorShortcut(
  event: KeyboardEvent,
): NavigatorShortcut | null {
  const mod = hasMod(event);
  const { altKey: alt, shiftKey: shift, key } = event;
  if (!mod && !alt && !shift) {
    if (key === "F2") return "rename";
    if (key === "Delete") return "delete";
    if (key === "ContextMenu") return "menu";
  }
  if (mod && !alt && !shift && key === "Backspace") return "delete";
  if (shift && !mod && !alt && key === "F10") return "menu";
  if (alt && !mod && !shift) {
    if (key === "ArrowUp") return "moveUp";
    if (key === "ArrowDown") return "moveDown";
  }
  return null;
}

export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(globalThis.navigator.userAgent);
}

// The keys each navigator shortcut shows in menus and the reference.
export function navigatorKeys(
  apple = isApplePlatform(),
): Record<NavigatorShortcut, Keys> {
  return {
    rename: ["F2"],
    delete: apple ? ["Mod", "Backspace"] : ["Delete"],
    menu: ["Shift", "F10"],
    moveUp: ["Alt", "ArrowUp"],
    moveDown: ["Alt", "ArrowDown"],
  };
}

const keyNames: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ContextMenu: "Menu",
  Escape: "Esc",
};
const appleModifiers: [string, string][] = [
  ["Control", "⌃"],
  ["Alt", "⌥"],
  ["Shift", "⇧"],
  ["Mod", "⌘"],
];
const otherModifiers: Record<string, string> = {
  Mod: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

// Shows keys as each platform writes them: ⇧⌘\ on Apple platforms and
// Ctrl+Shift+\ elsewhere.
export function keyLabel(keys: Keys, apple = isApplePlatform()): string {
  const key = keys.at(-1) ?? "";
  const modifiers = keys.slice(0, -1);
  if (apple) {
    const name = key === "Backspace" ? "⌫" : (keyNames[key] ?? key);
    return (
      appleModifiers
        .filter(([modifier]) => modifiers.includes(modifier))
        .map(([, symbol]) => symbol)
        .join("") + name
    );
  }
  return [
    ...modifiers.map((modifier) => otherModifiers[modifier] ?? modifier),
    keyNames[key] ?? key,
  ].join("+");
}

// The aria-keyshortcuts value, listing Mod as both accepted modifiers.
export function ariaKeys(keys: Keys): string {
  if (!keys.includes("Mod")) return keys.join("+");
  return ["Control", "Meta"]
    .map((mod) => keys.map((key) => (key === "Mod" ? mod : key)).join("+"))
    .join(" ");
}
