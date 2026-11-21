import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ChevronRight,
  ChevronsDownUp,
  Ellipsis,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  Toolbar,
  Tooltip,
  TooltipTrigger,
  Tree,
  TreeItem,
  TreeItemContent,
} from "react-aria-components";
import type { ItemKind } from "../api/client";
import { useQueryFailure } from "../api/useQueryFailure";
import {
  useChangeFailures,
  useWorkspaceChange,
  useWorkspaceTree,
} from "../api/workspaceChanges";
import {
  ancestorIds,
  buildTree,
  subtreeIds,
  type TreeNode,
} from "../api/workspaceTree";
import controls from "../shell/controls.module.css";
import { useSaveManager } from "../saving/saveManager";
import { useStoredSet } from "../shell/preferences";
import { failureMessage } from "./changeFailure";
import { DeleteDialog } from "./DeleteDialog";
import styles from "./Navigator.module.css";

const commands = [
  "newDocument",
  "newFolder",
  "rename",
  "expandAll",
  "collapseAll",
  "delete",
] as const;
type Command = (typeof commands)[number];

function isCommand(key: unknown): key is Command {
  return commands.some((command) => command === key);
}

// The item whose title is being edited in place.
interface Naming {
  id: string;
  kind: ItemKind;
  title: string;
  isNew: boolean;
}

// An open context menu: the row it was raised on, or null for the empty
// part of the tree, and where it was raised, relative to the tree's frame.
interface ContextMenu {
  node: TreeNode | null;
  x: number;
  y: number;
}

const newTitle = "Untitled";

function folderIdsIn(node: TreeNode): string[] {
  if (node.kind !== "folder") return [];
  return [node.id, ...node.children.flatMap(folderIdsIn)];
}

function isRenameField(target: EventTarget): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement && target.dataset.rename !== undefined
  );
}

// The workspace tree: folders and documents in the service's order, built
// on React Aria's Tree, which follows the WAI-ARIA treegrid pattern.
export function Navigator() {
  const { documentId } = useParams({ strict: false });
  const navigate = useNavigate();
  const { query, items } = useWorkspaceTree();
  const loadFailure = useQueryFailure(query);
  const change = useWorkspaceChange();
  const saveManager = useSaveManager();
  const { failures, dismiss } = useChangeFailures();
  const [expanded, updateExpanded] = useStoredSet("navigator.expanded");
  const [naming, setNaming] = useState<Naming | null>(null);
  const namingRef = useRef<Naming | null>(null);
  const [deleting, setDeleting] = useState<TreeNode | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Each new document's create, so it opens once the service has it.
  const creates = useRef(new Map<string, Promise<boolean>>());
  const revealed = useRef<string | undefined>(undefined);

  const roots = useMemo(() => buildTree(items ?? []), [items]);
  const nodes = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const visit = (node: TreeNode) => {
      map.set(node.id, node);
      node.children.forEach(visit);
    };
    roots.forEach(visit);
    return map;
  }, [roots]);
  const folderIds = useMemo(
    () =>
      [...nodes.values()]
        .filter((node) => node.kind === "folder")
        .map((node) => node.id),
    [nodes],
  );
  const openDocument =
    documentId && nodes.get(documentId)?.kind === "document"
      ? documentId
      : undefined;

  // Expands the folders around a document opened by URL, once per opening,
  // so collapsing one of them afterwards sticks.
  useEffect(() => {
    if (!documentId || !items || revealed.current === documentId) return;
    const ancestors = ancestorIds(items, documentId);
    if (!ancestors) return;
    revealed.current = documentId;
    updateExpanded((current) =>
      ancestors.every((id) => current.has(id))
        ? current
        : new Set([...current, ...ancestors]),
    );
  }, [documentId, items, updateExpanded]);

  function rowElement(id: string): HTMLElement | undefined {
    const rows =
      frameRef.current?.querySelectorAll<HTMLElement>("[data-item-id]") ?? [];
    return [...rows].find((row) => row.dataset.itemId === id);
  }

  function expand(ids: string[]) {
    updateExpanded((current) =>
      ids.every((id) => current.has(id))
        ? current
        : new Set([...current, ...ids]),
    );
  }

  function collapse(ids: string[] | "all") {
    updateExpanded((current) => {
      if (ids === "all") return current.size === 0 ? current : new Set();
      if (!ids.some((id) => current.has(id))) return current;
      return new Set([...current].filter((id) => !ids.includes(id)));
    });
  }

  function toggle(id: string) {
    updateExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function startNaming(next: Naming) {
    namingRef.current = next;
    setNaming(next);
  }

  // Ends the inline title edit, renaming when the trimmed title changed. A
  // new document opens once the service has created it.
  function finishNaming(value: string | null, refocus: boolean) {
    const current = namingRef.current;
    if (!current) return;
    namingRef.current = null;
    setNaming(null);
    const title = value?.trim();
    if (title && title !== current.title) {
      void change({
        type: "rename",
        kind: current.kind,
        id: current.id,
        title,
      });
    }
    if (refocus) rowElement(current.id)?.focus();
    const created = creates.current.get(current.id);
    if (created) {
      creates.current.delete(current.id);
      void created.then((accepted) => {
        if (accepted) {
          void navigate({
            to: "/documents/$documentId",
            params: { documentId: current.id },
          });
        }
      });
    }
  }

  function create(kind: ItemKind, parentId: string | null) {
    const id = crypto.randomUUID();
    if (parentId !== null) expand([parentId]);
    const created = change({
      type: "create",
      kind,
      id,
      parentId,
      beforeId: null,
      title: newTitle,
    });
    if (kind === "document") creates.current.set(id, created);
    startNaming({ id, kind, title: newTitle, isNew: true });
  }

  function remove(node: TreeNode) {
    const removed = subtreeIds(items ?? [], node.id);
    saveManager.discard(removed);
    if (documentId && removed.includes(documentId)) void navigate({ to: "/" });
    void change({ type: "delete", kind: node.kind, id: node.id }).then(
      (accepted) => {
        if (accepted) collapse(removed);
      },
    );
  }

  function run(command: Command, node: TreeNode | null) {
    switch (command) {
      case "newDocument":
        create("document", node?.id ?? null);
        break;
      case "newFolder":
        create("folder", node?.id ?? null);
        break;
      case "rename":
        if (node) {
          startNaming({
            id: node.id,
            kind: node.kind,
            title: node.title,
            isNew: false,
          });
        }
        break;
      case "expandAll":
        if (node) expand(folderIdsIn(node));
        break;
      case "collapseAll":
        collapse(node ? folderIdsIn(node) : "all");
        break;
      case "delete":
        if (node) setDeleting(node);
        break;
    }
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame || isRenameField(event.target)) return;
    event.preventDefault();
    const row =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-item-id]")
        : null;
    const node = (row && nodes.get(row.dataset.itemId ?? "")) || null;
    let { clientX: x, clientY: y } = event;
    // A menu raised from the keyboard has no pointer position.
    if (x === 0 && y === 0) {
      const box = (row ?? frame).getBoundingClientRect();
      x = box.left;
      y = box.bottom;
    }
    const bounds = frame.getBoundingClientRect();
    setContextMenu({ node, x: x - bounds.left, y: y - bounds.top });
  }

  // The rename field's keys, presses, and focus belong to it. The tree's
  // rows handle keys in their capture phase, moving focus between rows,
  // selecting, and finding titles by typing, so the field's events are
  // stopped here, above the tree, before any row sees them.
  function stopForField(event: SyntheticEvent) {
    if (isRenameField(event.target)) event.stopPropagation();
  }
  const fieldHandlers = {
    onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
      const field = event.target;
      if (!isRenameField(field) || event.key === "Tab") return;
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finishNaming(event.key === "Enter" ? field.value : null, true);
      }
    },
    onKeyUpCapture: stopForField,
    onPointerDownCapture: stopForField,
    onPointerUpCapture: stopForField,
    onMouseDownCapture: stopForField,
    onClickCapture: stopForField,
    onFocusCapture: stopForField,
    onBlurCapture(event: FocusEvent<HTMLDivElement>) {
      const field = event.target;
      if (!isRenameField(field)) return;
      event.stopPropagation();
      finishNaming(field.value, false);
    },
  };

  if (!items) {
    return loadFailure ? (
      <div className={styles.status}>
        <p className={styles.statusText}>
          Writer can't load your folders and documents.
        </p>
        <Button
          className={styles.statusAction}
          onPress={() => void query.refetch()}
        >
          Try again
        </Button>
      </div>
    ) : (
      <p className={styles.statusText} aria-busy>
        Loading your folders and documents…
      </p>
    );
  }

  function renderNode(node: TreeNode): ReactNode {
    const isFolder = node.kind === "folder";
    return (
      <TreeItem
        key={node.id}
        id={node.id}
        textValue={node.title}
        hasChildItems={isFolder}
        className={styles.row}
        data-item-id={node.id}
        {...(isFolder ? { onAction: () => toggle(node.id) } : {})}
      >
        <TreeItemContent>
          {({ isExpanded, level }) => (
            <div className={styles.cell}>
              {level > 1 ? (
                <span className={styles.indent} aria-hidden>
                  {Array.from({ length: level - 1 }, (_, index) => (
                    <span key={index} className={styles.guide} />
                  ))}
                </span>
              ) : null}
              {isFolder ? (
                <Button slot="chevron" className={styles.chevron}>
                  <ChevronRight aria-hidden size={14} />
                </Button>
              ) : (
                <span className={styles.chevron} aria-hidden />
              )}
              <ItemIcon kind={node.kind} isExpanded={isExpanded} />
              {naming?.id === node.id ? (
                <RenameField title={naming.title} />
              ) : (
                <span className={styles.title}>{node.title}</span>
              )}
              <span className={styles.actions}>
                {isFolder ? (
                  <>
                    <RowButton
                      label="New document"
                      icon={FilePlus}
                      className={styles.createButton}
                      onPress={() => create("document", node.id)}
                    />
                    <RowButton
                      label="New folder"
                      icon={FolderPlus}
                      className={styles.createButton}
                      onPress={() => create("folder", node.id)}
                    />
                  </>
                ) : null}
                <MenuTrigger>
                  <RowButton label="More actions" icon={Ellipsis} />
                  <Popover className={styles.popover} placement="bottom end">
                    <ItemMenu
                      node={node}
                      onCommand={(command) => run(command, node)}
                    />
                  </Popover>
                </MenuTrigger>
              </span>
            </div>
          )}
        </TreeItemContent>
        {node.children.map(renderNode)}
      </TreeItem>
    );
  }

  return (
    <div className={styles.navigator}>
      <Toolbar aria-label="Workspace" className={styles.toolbar}>
        <ToolbarButton
          label="New document"
          icon={FilePlus}
          onPress={() => create("document", null)}
        />
        <ToolbarButton
          label="New folder"
          icon={FolderPlus}
          onPress={() => create("folder", null)}
        />
        <ToolbarButton
          label="Collapse all folders"
          icon={ChevronsDownUp}
          onPress={() => collapse("all")}
        />
      </Toolbar>
      <div className={styles.notices} aria-live="polite">
        {failures.slice(-3).map((failure) => (
          <div key={failure.mutationId} className={styles.notice}>
            <span className={styles.noticeText}>
              {failureMessage(failure.change, failure.error)}
            </span>
            <Button
              className={styles.rowButton}
              aria-label="Dismiss"
              onPress={() => dismiss(failure.mutationId)}
            >
              <X aria-hidden size={14} />
            </Button>
          </div>
        ))}
      </div>
      <div
        ref={frameRef}
        className={styles.frame}
        onContextMenu={onContextMenu}
        {...fieldHandlers}
      >
        <Tree
          aria-label="Folders and documents"
          className={styles.tree}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={openDocument ? [openDocument] : []}
          onSelectionChange={(keys) => {
            if (keys === "all") return;
            const [key] = keys;
            const node = typeof key === "string" ? nodes.get(key) : undefined;
            if (node?.kind === "document" && key !== documentId) {
              void navigate({
                to: "/documents/$documentId",
                params: { documentId: node.id },
              });
            }
          }}
          disabledKeys={folderIds}
          disabledBehavior="selection"
          expandedKeys={expanded}
          onExpandedChange={(keys) =>
            updateExpanded(() => new Set([...keys].map(String)))
          }
          renderEmptyState={() => (
            <p className={styles.statusText}>
              No folders or documents yet. Create one with the buttons above.
            </p>
          )}
        >
          {roots.map(renderNode)}
        </Tree>
        <span
          ref={anchorRef}
          className={styles.anchor}
          style={
            contextMenu
              ? {
                  insetInlineStart: contextMenu.x,
                  insetBlockStart: contextMenu.y,
                }
              : undefined
          }
        />
        {contextMenu ? (
          <Popover
            className={styles.popover}
            triggerRef={anchorRef}
            placement="bottom start"
            isOpen
            onOpenChange={(isOpen) => {
              if (!isOpen) setContextMenu(null);
            }}
          >
            <ItemMenu
              node={contextMenu.node}
              onCommand={(command) => {
                setContextMenu(null);
                run(command, contextMenu.node);
              }}
            />
          </Popover>
        ) : null}
      </div>
      {deleting ? (
        <DeleteDialog
          kind={deleting.kind}
          title={deleting.title}
          descendants={subtreeIds(items, deleting.id).length - 1}
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

function ItemIcon({
  kind,
  isExpanded,
}: {
  kind: ItemKind;
  isExpanded: boolean;
}) {
  const Icon =
    kind === "document" ? FileText : isExpanded ? FolderOpen : Folder;
  return <Icon aria-hidden size={16} className={styles.icon} />;
}

// Edits a title in place. It takes focus once mounted, after any menu that
// opened it has closed, and selects the old title for typing over.
function RenameField({ title }: { title: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className={styles.rename}
      defaultValue={title}
      aria-label="Title"
      data-rename=""
      spellCheck={false}
      autoComplete="off"
    />
  );
}

// The commands for a row, or for the top level when node is null.
function ItemMenu({
  node,
  onCommand,
}: {
  node: TreeNode | null;
  onCommand: (command: Command) => void;
}) {
  const isFolder = node?.kind === "folder";
  return (
    <Menu
      className={styles.menu}
      aria-label={node ? `Actions for ${node.title}` : "Workspace actions"}
      onAction={(key) => {
        if (isCommand(key)) onCommand(key);
      }}
    >
      {!node || isFolder ? (
        <MenuItem id="newDocument" className={styles.menuItem}>
          New document
        </MenuItem>
      ) : null}
      {!node || isFolder ? (
        <MenuItem id="newFolder" className={styles.menuItem}>
          New folder
        </MenuItem>
      ) : null}
      {isFolder ? <Separator className={styles.separator} /> : null}
      {isFolder ? (
        <MenuItem id="expandAll" className={styles.menuItem}>
          Expand all inside
        </MenuItem>
      ) : null}
      <MenuItem id="collapseAll" className={styles.menuItem}>
        {node ? "Collapse all inside" : "Collapse all folders"}
      </MenuItem>
      {node ? <Separator className={styles.separator} /> : null}
      {node ? (
        <MenuItem id="rename" className={styles.menuItem}>
          Rename
        </MenuItem>
      ) : null}
      {node ? (
        <MenuItem id="delete" className={styles.menuItem}>
          Delete…
        </MenuItem>
      ) : null}
    </Menu>
  );
}

interface IconButtonProps {
  label: string;
  icon: LucideIcon;
  onPress?: () => void;
  className?: string;
}

function RowButton({ label, icon: Icon, onPress, className }: IconButtonProps) {
  return (
    <Button
      className={`${styles.rowButton} ${className ?? ""}`}
      aria-label={label}
      {...(onPress ? { onPress } : {})}
    >
      <Icon aria-hidden size={14} />
    </Button>
  );
}

function ToolbarButton({ label, icon: Icon, onPress }: IconButtonProps) {
  return (
    <TooltipTrigger delay={600}>
      <Button
        className={controls.iconButton}
        aria-label={label}
        {...(onPress ? { onPress } : {})}
      >
        <Icon aria-hidden size={18} />
      </Button>
      <Tooltip className={controls.tooltip} offset={6}>
        {label}
      </Tooltip>
    </TooltipTrigger>
  );
}
