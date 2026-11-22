import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { healthQueryOptions } from "../api/queries";
import { useQueryFailure } from "../api/useQueryFailure";
import { AssistantPane } from "../workspace/AssistantPane";
import { useConversation } from "../workspace/conversation";
import { Navigator } from "../workspace/Navigator";
import { SaveNotices } from "../workspace/SaveNotices";
import { ServiceUnavailable } from "../workspace/ServiceUnavailable";
import { Header } from "./Header";
import { Pane } from "./Pane";
import {
  focusRegion,
  nextRegion,
  regionElement,
  regionOf,
  type Region,
} from "./regions";
import { isReferenceShortcut, paneForShortcut, regionStep } from "./shortcuts";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { usePane } from "./usePane";
import styles from "./WorkspaceShell.module.css";

// The root layout: a header above the navigator, the writing region, and the
// assistant. The writing region shows the route, or a message while the
// service cannot be reached.
export function WorkspaceShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigator = usePane("navigator", pathname);
  const assistant = usePane("assistant", pathname);
  const health = useQuery(healthQueryOptions);
  const conversation = useConversation();
  const [showingShortcuts, setShowingShortcuts] = useState(false);

  const toggleNavigator = navigator.toggle;
  const toggleAssistant = assistant.toggle;
  // F6 visits the writing region and the panes docked open beside it.
  const navigatorShown = navigator.docked && navigator.open;
  const assistantShown = assistant.docked && assistant.open;
  // A pane opened over the writing region, which holds focus while open.
  const overlaid =
    (!navigator.docked && navigator.open && navigator.name) ||
    (!assistant.docked && assistant.open && assistant.name) ||
    null;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isReferenceShortcut(event)) {
        event.preventDefault();
        setShowingShortcuts((showing) => !showing);
        return;
      }
      const step = regionStep(event);
      if (step) {
        event.preventDefault();
        // Behind a menu, dialog, or overlaid pane, F6 moves focus only to
        // an overlaid pane's own control, such as the tree.
        const hidden = "[aria-hidden='true'], [inert]";
        if (regionElement("writing")?.closest(hidden)) {
          const pane = overlaid && regionElement(overlaid);
          if (overlaid && pane && !pane.closest(hidden)) focusRegion(overlaid);
          return;
        }
        const shown: Region[] = ["writing"];
        if (navigatorShown) shown.push("navigator");
        if (assistantShown) shown.push("assistant");
        const next = nextRegion(regionOf(document.activeElement), step, shown);
        if (next) focusRegion(next);
        return;
      }
      const pane = paneForShortcut(event);
      if (!pane) return;
      event.preventDefault();
      if (pane === "navigator") toggleNavigator();
      else toggleAssistant();
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [
    toggleNavigator,
    toggleAssistant,
    navigatorShown,
    assistantShown,
    overlaid,
  ]);

  // Shown from the first failed attempt, through retries, until one succeeds.
  const failure = useQueryFailure(health);

  return (
    <div className={styles.shell}>
      <Header
        navigator={navigator}
        assistant={assistant}
        onShowShortcuts={() => setShowingShortcuts(true)}
      />
      <div className={styles.body}>
        <Pane pane={navigator} label="Navigator" landmark="nav">
          <Navigator />
        </Pane>
        <main className={styles.writing} data-region="writing" tabIndex={-1}>
          <SaveNotices />
          {failure ? (
            <ServiceUnavailable
              error={failure}
              onRetry={() => void health.refetch()}
            />
          ) : (
            <Outlet />
          )}
        </main>
        <Pane pane={assistant} label="Assistant" landmark="aside">
          <AssistantPane conversation={conversation} />
        </Pane>
      </div>
      {showingShortcuts ? (
        <ShortcutsDialog onClose={() => setShowingShortcuts(false)} />
      ) : null}
    </div>
  );
}
