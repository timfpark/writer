import { useCallback, useState } from "react";
import { useStoredBoolean } from "./preferences";
import { focusRegion, regionElement } from "./regions";
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
      // Hiding the pane would leave focus nowhere, so it moves to the
      // writing region first. An overlaid pane returns focus itself.
      if (open && regionElement(name)?.contains(document.activeElement)) {
        focusRegion("writing");
      }
      setCollapsed(open);
    } else {
      setOverlayOpen(!open);
    }
  }, [name, docked, open, setCollapsed]);
  const close = useCallback(() => {
    setOverlayOpen(false);
  }, []);

  return { name, docked, open, toggle, close };
}
