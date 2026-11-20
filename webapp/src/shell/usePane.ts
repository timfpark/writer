import { useCallback, useState } from "react";
import { useStoredBoolean } from "./preferences";
import { useMediaQuery } from "./useMediaQuery";

export type PaneName = "navigator" | "assistant";

// ADR 0007's breakpoints: the navigator docks from 60 rem and the assistant
// from 75 rem; narrower, each opens over the writing region.
const dockedQuery: Record<PaneName, string> = {
  navigator: "(min-width: 60rem)",
  assistant: "(min-width: 75rem)",
};

export interface PaneState {
  name: PaneName;
  docked: boolean;
  open: boolean;
  toggle: () => void;
  close: () => void;
}

// A docked pane's collapsed state persists across reloads. An overlaid pane
// always starts closed, and closes when the route or the docking changes.
export function usePane(name: PaneName, pathname: string): PaneState {
  const docked = useMediaQuery(dockedQuery[name]);
  const [collapsed, setCollapsed] = useStoredBoolean(
    `${name}.collapsed`,
    false,
  );
  const [overlayOpen, setOverlayOpen] = useState(false);
  const context = `${docked}:${pathname}`;
  const [openedIn, setOpenedIn] = useState(context);
  if (openedIn !== context) {
    setOpenedIn(context);
    setOverlayOpen(false);
  }

  const open = docked ? !collapsed : overlayOpen;
  const toggle = useCallback(() => {
    if (docked) {
      setCollapsed(open);
    } else {
      setOverlayOpen(!open);
    }
  }, [docked, open, setCollapsed]);
  const close = useCallback(() => {
    setOverlayOpen(false);
  }, []);

  return { name, docked, open, toggle, close };
}
