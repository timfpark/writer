import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { healthQueryOptions } from "../api/queries";
import { useQueryFailure } from "../api/useQueryFailure";
import { AssistantPane } from "../workspace/AssistantPane";
import { useConversation } from "../workspace/conversation";
import { Navigator } from "../workspace/Navigator";
import { SaveNotices } from "../workspace/SaveNotices";
import { ServiceUnavailable } from "../workspace/ServiceUnavailable";
import { Header } from "./Header";
import { Pane } from "./Pane";
import { paneForShortcut } from "./shortcuts";
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

  const toggleNavigator = navigator.toggle;
  const toggleAssistant = assistant.toggle;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
  }, [toggleNavigator, toggleAssistant]);

  // Shown from the first failed attempt, through retries, until one succeeds.
  const failure = useQueryFailure(health);

  return (
    <div className={styles.shell}>
      <Header navigator={navigator} assistant={assistant} />
      <div className={styles.body}>
        <Pane pane={navigator} label="Navigator" landmark="nav">
          <Navigator />
        </Pane>
        <main className={styles.writing}>
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
    </div>
  );
}
