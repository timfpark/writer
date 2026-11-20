import { useCallback, useSyncExternalStore } from "react";

// Whether the viewport matches a media query, following changes. Where
// matchMedia is missing, every query matches, so panes dock.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof globalThis.matchMedia !== "function") {
        return () => {};
      }
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () =>
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia(query).matches
      : true,
  );
}
