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
