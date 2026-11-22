import { describe, expect, it } from "vitest";
import { nextRegion } from "./regions";
import { ariaKeys, keyLabel, navigatorShortcut } from "./shortcuts";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("shortcuts", () => {
  it.each([
    [{ key: "F2" }, "rename"],
    [{ key: "Delete" }, "delete"],
    [{ key: "Backspace", metaKey: true }, "delete"],
    [{ key: "Backspace", ctrlKey: true }, "delete"],
    [{ key: "F10", shiftKey: true }, "menu"],
    [{ key: "ContextMenu" }, "menu"],
    [{ key: "ArrowUp", altKey: true }, "moveUp"],
    [{ key: "ArrowDown", altKey: true }, "moveDown"],
    [{ key: "Backspace" }, null],
    [{ key: "F2", shiftKey: true }, null],
    [{ key: "ArrowDown" }, null],
    [{ key: "ArrowDown", altKey: true, shiftKey: true }, null],
  ])("reads %o in the navigator as %s", (init, expected) => {
    expect(navigatorShortcut(key(init))).toBe(expected);
  });

  it.each([
    [["Mod", "Shift", "\\"], "⇧⌘\\", "Ctrl+Shift+\\"],
    [["Alt", "ArrowUp"], "⌥↑", "Alt+↑"],
    [["Mod", "Backspace"], "⌘⌫", "Ctrl+Backspace"],
    [["Shift", "F10"], "⇧F10", "Shift+F10"],
  ])(
    "labels %o as %s on Apple platforms and %s elsewhere",
    (keys, apple, other) => {
      expect(keyLabel(keys, true)).toBe(apple);
      expect(keyLabel(keys, false)).toBe(other);
    },
  );

  it("lists both modifiers Mod stands for in aria-keyshortcuts", () => {
    expect(ariaKeys(["Mod", "Shift", "\\"])).toBe(
      "Control+Shift+\\ Meta+Shift+\\",
    );
    expect(ariaKeys(["Shift", "F10"])).toBe("Shift+F10");
  });
});

describe("regions", () => {
  const all = ["navigator", "writing", "assistant"] as const;

  it("steps through the shown regions in order and wraps around", () => {
    expect(nextRegion("navigator", 1, [...all])).toBe("writing");
    expect(nextRegion("assistant", 1, [...all])).toBe("navigator");
    expect(nextRegion("navigator", -1, [...all])).toBe("assistant");
    expect(nextRegion("writing", 1, ["writing", "assistant"])).toBe(
      "assistant",
    );
    expect(nextRegion("writing", 1, ["writing"])).toBe("writing");
  });

  it("starts at the first or last region from outside them all", () => {
    expect(nextRegion(null, 1, [...all])).toBe("navigator");
    expect(nextRegion(null, -1, [...all])).toBe("assistant");
    expect(nextRegion("navigator", 1, ["writing"])).toBe("writing");
  });
});
