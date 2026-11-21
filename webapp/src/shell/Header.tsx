import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { PanelLeft, PanelRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { documentQueryOptions } from "../api/queries";
import { useWorkspaceChange, useWorkspaceTree } from "../api/workspaceChanges";
import { useSaveStatus } from "../saving/saveManager";
import controls from "./controls.module.css";
import styles from "./Header.module.css";
import { paneId } from "./Pane";
import { ProfileMenu } from "./ProfileMenu";
import { SaveIndicator } from "./SaveIndicator";
import { ariaShortcut, shortcutLabel } from "./shortcuts";
import type { PaneState } from "./usePane";

interface HeaderProps {
  navigator: PaneState;
  assistant: PaneState;
}

// Lays out over the same columns as the region below, so the title centers
// over the writing column whichever side panes are docked open.
export function Header({ navigator, assistant }: HeaderProps) {
  return (
    <header
      className={styles.header}
      data-navigator={navigator.docked && navigator.open ? "docked" : undefined}
      data-assistant={assistant.docked && assistant.open ? "docked" : undefined}
    >
      <div className={styles.start}>
        <PaneToggle pane={navigator} label="Navigator" icon={PanelLeft} />
      </div>
      <div className={styles.columns}>
        <div className={styles.startPane} />
        <DocumentTitle />
        <div className={styles.endPane} />
      </div>
      <div className={styles.end}>
        <PaneToggle pane={assistant} label="Assistant" icon={PanelRight} />
        <ProfileMenu />
      </div>
    </header>
  );
}

// The id of the title, which names the writing surface.
export const titleId = "document-title";

// The title slot: the open document's title, edited in place, and its save
// status, or Writer's name when no document is open.
function DocumentTitle() {
  const { documentId } = useParams({ strict: false });
  const document = useQuery(documentQueryOptions(documentId ?? ""));
  const { items } = useWorkspaceTree();
  const title =
    items?.find((item) => item.id === documentId)?.title ??
    document.data?.title;
  if (!documentId || title === undefined) {
    return (
      <div className={styles.center}>
        <div className={styles.lead}>
          <h1 id={titleId} className={styles.title}>
            Writer
          </h1>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.center}>
      <div className={styles.lead}>
        <TitleField key={documentId} documentId={documentId} title={title} />
        <div className={styles.status}>
          <DocumentSaveIndicator documentId={documentId} />
        </div>
      </div>
    </div>
  );
}

function DocumentSaveIndicator({ documentId }: { documentId: string }) {
  return <SaveIndicator status={useSaveStatus(documentId)} />;
}

// Shows the title as a button that turns into a field. Enter or leaving the
// field renames the document, and Escape cancels.
function TitleField({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const change = useWorkspaceChange();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  // Whether the field is open, so a blur as it closes changes nothing.
  const open = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  function start() {
    open.current = true;
    setEditing(true);
  }

  function finish(value: string | null, returnFocus: boolean) {
    if (!open.current) return;
    open.current = false;
    refocus.current = returnFocus;
    setEditing(false);
    const next = value?.trim();
    if (next && next !== title) {
      void change({
        type: "rename",
        kind: "document",
        id: documentId,
        title: next,
      });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finish(event.key === "Enter" ? event.currentTarget.value : null, true);
    }
  }

  return (
    <>
      <span id={`${titleId}-hint`} hidden>
        Rename
      </span>
      <h1 id={titleId} className={`${styles.title} ${styles.editable}`}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.titleInput}
            defaultValue={title}
            aria-label="Document title"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={onKeyDown}
            onBlur={(event) => finish(event.currentTarget.value, false)}
          />
        ) : (
          <TooltipTrigger delay={600}>
            <Button
              ref={buttonRef}
              className={styles.titleButton}
              aria-describedby={`${titleId}-hint`}
              onPress={start}
            >
              {title}
            </Button>
            <Tooltip className={controls.tooltip} offset={6}>
              Rename
            </Tooltip>
          </TooltipTrigger>
        )}
      </h1>
    </>
  );
}

interface PaneToggleProps {
  pane: PaneState;
  label: string;
  icon: LucideIcon;
}

function PaneToggle({ pane, label, icon: Icon }: PaneToggleProps) {
  return (
    <TooltipTrigger delay={600}>
      <ToggleButton
        className={controls.iconButton}
        aria-label={label}
        aria-keyshortcuts={ariaShortcut(pane.name)}
        {...(pane.docked ? { "aria-controls": paneId(pane) } : {})}
        isSelected={pane.open}
        onChange={pane.toggle}
      >
        <Icon aria-hidden size={18} />
      </ToggleButton>
      <Tooltip className={controls.tooltip} offset={6}>
        {`${pane.open ? "Hide" : "Show"} ${label.toLowerCase()} (${shortcutLabel(pane.name)})`}
      </Tooltip>
    </TooltipTrigger>
  );
}
