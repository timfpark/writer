import { useQuery } from "@tanstack/react-query";
import { Outlet, useParams, useRouterState } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { documentQueryOptions, healthQueryOptions } from "../api/queries";
import { useQueryFailure } from "../api/useQueryFailure";
import { useWorkspaceTree } from "../api/workspaceChanges";
import { AssistantContext, ConversationStore } from "../workspace/conversation";
import { EditorBridge, EditorBridgeContext } from "../workspace/editorBridge";
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
import { usePane } from "./usePane";
import styles from "./WorkspaceShell.module.css";

const loadAssistantPane = () =>
  import("../workspace/AssistantPane").then((module) => ({
    default: module.AssistantPane,
  }));
const AssistantPane = lazy(loadAssistantPane);

const ReadOnlySourceView = lazy(() =>
  import("../workspace/ReadOnlySourceView").then((module) => ({
    default: module.ReadOnlySourceView,
  })),
);

const ShortcutsDialog = lazy(() =>
  import("./ShortcutsDialog").then((module) => ({
    default: module.ShortcutsDialog,
  })),
);

// Announces finished pair-writer replies politely without moving focus or
// re-rendering the workspace shell on every streamed token.
function AssistantAnnouncer({ store }: { store: ConversationStore }) {
  const announcement = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().announcement,
  );
  return (
    <output className={styles.srOnly} aria-live="polite" aria-atomic="true">
      {announcement?.text ?? ""}
    </output>
  );
}

// Renders the read-only source view over the writing region while keeping the
// live document editor mounted so unsaved edits and undo history stay intact.
function WritingRegionBody({
  store,
  failure,
  onRetry,
}: {
  store: ConversationStore;
  failure: unknown;
  onRetry: () => void;
}) {
  const viewingSource = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().viewingSource,
  );

  if (failure) {
    return <ServiceUnavailable error={failure} onRetry={onRetry} />;
  }

  return (
    <>
      {viewingSource ? (
        <Suspense fallback={null}>
          <ReadOnlySourceView
            key={`${viewingSource.documentId}:${viewingSource.subtitle}`}
            source={viewingSource}
            onClose={() => store.closeSource()}
          />
        </Suspense>
      ) : null}
      <div className={styles.outletWrap} hidden={viewingSource !== null}>
        <Outlet />
      </div>
    </>
  );
}

// Keeps ConversationStore synced with the open document, pane visibility, and
// workspace document titles without subscribing WorkspaceShell (and Navigator)
// to workspace-tree or document-metadata query updates.
function ConversationSync({
  store,
  assistantOpen,
}: {
  store: ConversationStore;
  assistantOpen: boolean;
}) {
  const { documentId } = useParams({ strict: false });
  const { items } = useWorkspaceTree();
  const openDocQuery = useQuery(documentQueryOptions(documentId ?? ""));
  const openDocTitle =
    items?.find((item) => item.id === documentId)?.title ??
    openDocQuery.data?.title ??
    "";

  useEffect(() => {
    store.setOpenDocument(documentId ?? null, openDocTitle);
  }, [store, documentId, openDocTitle]);

  useEffect(() => {
    store.setAssistantOpen(assistantOpen);
  }, [store, assistantOpen]);

  useEffect(() => {
    if (!items) return;
    const titles = new Map<string, string>();
    for (const item of items) {
      if (item.kind === "document") titles.set(item.id, item.title);
    }
    store.syncWorkspaceTitles(titles);
  }, [store, items]);

  return null;
}

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
  const assistantService = useContext(AssistantContext);

  const [editorBridge] = useState(() => new EditorBridge());
  const [conversation] = useState(
    () => new ConversationStore(assistantService, editorBridge),
  );
  useEffect(() => {
    void loadAssistantPane();
  }, []);

  useEffect(() => {
    conversation.setAssistant(assistantService);
  }, [conversation, assistantService]);
  useEffect(() => () => conversation.dispose(), [conversation]);

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
    <EditorBridgeContext.Provider value={editorBridge}>
      <div className={styles.shell}>
        <Header
          navigator={navigator}
          assistant={assistant}
          conversation={conversation}
          onShowShortcuts={() => setShowingShortcuts(true)}
        />
        <div className={styles.body}>
          <Pane pane={navigator} label="Navigator" landmark="nav">
            <Navigator />
          </Pane>
          <main className={styles.writing} data-region="writing" tabIndex={-1}>
            <SaveNotices />
            <WritingRegionBody
              store={conversation}
              failure={failure}
              onRetry={() => void health.refetch()}
            />
          </main>
          <Pane pane={assistant} label="Assistant" landmark="aside">
            <Suspense fallback={null}>
              <AssistantPane
                store={conversation}
                onRevealWriting={() => {
                  if (!assistant.docked) assistant.close();
                }}
              />
            </Suspense>
          </Pane>
        </div>
        <ConversationSync store={conversation} assistantOpen={assistant.open} />
        <AssistantAnnouncer store={conversation} />
        {showingShortcuts ? (
          <Suspense fallback={null}>
            <ShortcutsDialog onClose={() => setShowingShortcuts(false)} />
          </Suspense>
        ) : null}
      </div>
    </EditorBridgeContext.Provider>
  );
}
