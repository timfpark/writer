import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { PanelLeft, PanelRight, type LucideIcon } from "lucide-react";
import { ToggleButton, Tooltip, TooltipTrigger } from "react-aria-components";
import { documentQueryOptions } from "../api/queries";
import controls from "./controls.module.css";
import styles from "./Header.module.css";
import { paneId } from "./Pane";
import { ProfileMenu } from "./ProfileMenu";
import { ariaShortcut, shortcutLabel } from "./shortcuts";
import type { PaneState } from "./usePane";

interface HeaderProps {
  navigator: PaneState;
  assistant: PaneState;
}

export function Header({ navigator, assistant }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.start}>
        <PaneToggle pane={navigator} label="Navigator" icon={PanelLeft} />
        <h1 className={styles.title}>
          <DocumentTitle />
        </h1>
      </div>
      <div className={styles.end}>
        <PaneToggle pane={assistant} label="Assistant" icon={PanelRight} />
        <ProfileMenu />
      </div>
    </header>
  );
}

// The title slot: the open document's title, or Writer's name when none is
// open. Backlog 23 makes it editable.
function DocumentTitle() {
  const { documentId } = useParams({ strict: false });
  const document = useQuery(documentQueryOptions(documentId ?? ""));
  return documentId && document.data ? document.data.title : "Writer";
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
