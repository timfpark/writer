import { useCallback, useState } from "react";

// Small preferences live in localStorage under keys starting "writer.", as
// ADR 0007 decides. A missing or unreadable value, or storage the browser
// refuses, falls back to the default.
const prefix = "writer.";

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = globalThis.localStorage.getItem(prefix + key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Storage is unavailable, so the default applies.
  }
  return fallback;
}

function writeBoolean(key: string, value: boolean): void {
  try {
    globalThis.localStorage.setItem(prefix + key, String(value));
  } catch {
    // The preference lasts only for this page.
  }
}

export function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => readBoolean(key, fallback));
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      writeBoolean(key, next);
    },
    [key],
  );
  return [value, update];
}

function readStrings(key: string): string[] {
  try {
    const raw = globalThis.localStorage.getItem(prefix + key);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      return value;
    }
  } catch {
    // Storage is unavailable or the value is unreadable, so the default applies.
  }
  return [];
}

function writeStrings(key: string, value: ReadonlySet<string>): void {
  try {
    globalThis.localStorage.setItem(prefix + key, JSON.stringify([...value]));
  } catch {
    // The preference lasts only for this page.
  }
}

// A set of strings, such as the expanded folders, empty by default. The
// setter takes a function of the current set, so callbacks never act on a
// stale one.
export function useStoredSet(
  key: string,
): [
  ReadonlySet<string>,
  (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
] {
  const [value, setValue] = useState<ReadonlySet<string>>(
    () => new Set(readStrings(key)),
  );
  const update = useCallback(
    (change: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
      setValue((current) => {
        const next = change(current);
        if (next !== current) writeStrings(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, update];
}
