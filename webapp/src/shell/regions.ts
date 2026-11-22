import type { PaneName } from "./usePane";

// The workspace's panes in F6 order. Each region's element carries
// data-region, and the control inside it that should take focus, such as
// the tree or the editor, carries data-focus-target.
export type Region = PaneName | "writing";

const order: Region[] = ["navigator", "writing", "assistant"];

// The region after (1) or before (-1) the current one among those shown,
// wrapping around. From outside them all, F6 starts at the first and
// Shift+F6 at the last.
export function nextRegion(
  current: Region | null,
  step: 1 | -1,
  shown: Region[],
): Region | null {
  const visible = order.filter((region) => shown.includes(region));
  const index = current === null ? -1 : visible.indexOf(current);
  if (index === -1) return (step === 1 ? visible[0] : visible.at(-1)) ?? null;
  return visible[(index + step + visible.length) % visible.length] ?? null;
}

export function regionElement(region: Region): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-region="${region}"]`);
}

export function regionOf(element: Element | null): Region | null {
  const region =
    element?.closest<HTMLElement>("[data-region]")?.dataset["region"];
  return order.find((name) => name === region) ?? null;
}

// Focuses a region's target, or the region itself when it has none, such
// as the writing region with no document open.
export function focusRegion(region: Region): void {
  const element = regionElement(region);
  if (!element) return;
  const target =
    element.querySelector<HTMLElement>("[data-focus-target]") ?? element;
  target.focus({ preventScroll: true });
}
