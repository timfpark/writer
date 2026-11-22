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
  GripVertical,
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
  DropIndicator,
  Keyboard,
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
  useDragAndDrop,
  type Key,
} from "react-aria-components";
import type { ItemKind, WorkspaceItem } from "../api/client";
import { useQueryFailure } from "../api/useQueryFailure";
import {
  useChangeFailures,
  useWorkspaceChange,
  useWorkspaceTree,
} from "../api/workspaceChanges";
import {
  ancestorIds,
  buildTree,
  dropPlacement,
  siblingPlacement,
  subtreeIds,
  type Placement,
  type TreeNode,
} from "../api/workspaceTree";
import controls from "../shell/controls.module.css";
import { useSaveManager } from "../saving/saveManager";
import { useStoredSet } from "../shell/preferences";
import {
  keyLabel,
  navigatorKeys,
  navigatorShortcut,
  type Keys,
} from "../shell/shortcuts";
import { failureMessage } from "./changeFailure";
import { DeleteDialog } from "./DeleteDialog";
import { MoveDialog } from "./MoveDialog";
import styles from "./Navigator.module.css";

const commands = [
  "newDocument",
  "newFolder",
  "rename",
  "moveUp",
  "moveDown",
  "moveTo",
  "expandAll",
  "collapseAll",
  "delete",
] as const;
type Command = (typeof commands)[number];

// A drag type private to the navigator, so nothing from outside the tree,
// such as text or files, can be dropped into it.
const itemDragType = "application/x-writer-item";

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
// part of the tree, where it was raised, relative to the tree's frame, and
// whether from the keyboard, which focuses its first command.
interface ContextMenu {
  node: TreeNode | null;
  x: number;
  y: number;
  fromKeyboard: boolean;
}

const newTitle = "Untitled";

function folderIdsIn(node: TreeNode): string[] {
  if (node.kind !== "folder") return [];
  return [node.id, ...node.children.flatMap(folderIdsIn)];
}

function rowIn(frame: HTMLElement | null, id: string): HTMLElement | undefined {
  const rows = frame?.querySelectorAll<HTMLElement>("[data-item-id]") ?? [];
  return [...rows].find((row) => row.dataset.itemId === id);
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
  const [moving, setMoving] = useState<TreeNode | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Each new document's create, so it opens once the service has it.
  const creates = useRef(new Map<string, Promise<boolean>>());
  const revealed = useRef<string | undefined>(undefined);
  // The row to focus once a move or deletion changes the tree from the one
  // it started from, or null for the tree itself. Moving a row's element in
  // the page takes focus from it, and a deleted row's focus would otherwise
  // be lost.
  const focusAfterChange = useRef<
    { id: string | null; from: WorkspaceItem[] | undefined } | undefined
  >(undefined);

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

  useEffect(() => {
    const pending = focusAfterChange.current;
    if (!pending || pending.from === items) return;
    focusAfterChange.current = undefined;
    const frame = frameRef.current;
    const target =
      pending.id === null
        ? frame?.querySelector<HTMLElement>("[role='treegrid']")
        : rowIn(frame, pending.id);
    if (target && document.activeElement !== target) target.focus();
  }, [items]);

  // The visible row nearest a removed subtree: the next one, or else the
  // previous one, or null when none is left.
  function rowBeside(id: string, removed: string[]): string | null {
    const rows = [
      ...(frameRef.current?.querySelectorAll<HTMLElement>("[data-item-id]") ??
        []),
    ].map((row) => row.dataset.itemId ?? "");
    const index = rows.indexOf(id);
    const kept = (ids: string[]) => ids.find((row) => !removed.includes(row));
    return (
      kept(rows.slice(index + 1)) ??
      kept(rows.slice(0, index).reverse()) ??
      null
    );
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
    if (refocus) rowIn(frameRef.current, current.id)?.focus();
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
    focusAfterChange.current = { id: rowBeside(node.id, removed), from: items };
    if (documentId && removed.includes(documentId)) void navigate({ to: "/" });
    void change({ type: "delete", kind: node.kind, id: node.id }).then(
      (accepted) => {
        if (accepted) collapse(removed);
      },
    );
  }

  // Moves an item to ADR 0005's placement, refusing a folder moved into its
  // own subtree, and expands the folders around its new place so it stays
  // in view.
  function move(node: TreeNode, placement: Placement) {
    const { parentId } = placement;
    if (parentId !== null) {
      if (subtreeIds(items ?? [], node.id).includes(parentId)) return;
      expand([parentId, ...(ancestorIds(items ?? [], parentId) ?? [])]);
    }
    focusAfterChange.current = { id: node.id, from: items };
    void change({ type: "move", kind: node.kind, id: node.id, ...placement });
  }

  const { dragAndDropHooks } = useDragAndDrop({
    // A draggable row would take pointer presses from the rename field.
    isDisabled: naming !== null,
    getItems: (keys) => [...keys].map((key) => ({ [itemDragType]: `${key}` })),
    getAllowedDropOperations: () => ["move"],
    acceptedDragTypes: [itemDragType],
    shouldAcceptItemDrop: (target) =>
      nodes.get(`${target.key}`)?.kind === "folder",
    onMove({ keys, target }) {
      const moved = [...keys].flatMap((key: Key) => nodes.get(`${key}`) ?? []);
      const placement = dropPlacement(
        items ?? [],
        `${target.key}`,
        target.dropPosition,
        new Set(moved.map((node) => node.id)),
      );
      if (!placement) return;
      for (const node of moved) move(node, placement);
    },
    renderDropIndicator: (target) => (
      <DropIndicator target={target} className={styles.dropIndicator} />
    ),
  });

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
      case "moveUp":
      case "moveDown": {
        const direction = command === "moveUp" ? "up" : "down";
        const placement =
          node && siblingPlacement(items ?? [], node.id, direction);
        if (node && placement) move(node, placement);
        break;
      }
      case "moveTo":
        if (node) setMoving(node);
        break;
      case "delete":
        if (node) setDeleting(node);
        break;
    }
  }

  // Opens the menu for a row, or for the top level when row is null, at a
  // pointer position in the page. A menu raised from the keyboard has no
  // pointer position, so it opens below the row.
  function openMenu(row: HTMLElement | null, x = 0, y = 0) {
    const frame = frameRef.current;
    if (!frame) return;
    const node = (row && nodes.get(row.dataset.itemId ?? "")) || null;
    const fromKeyboard = x === 0 && y === 0;
    if (fromKeyboard) {
      const box = (row ?? frame).getBoundingClientRect();
      x = box.left;
      y = box.bottom;
    }
    const bounds = frame.getBoundingClientRect();
    setContextMenu({
      node,
      x: x - bounds.left,
      y: y - bounds.top,
      fromKeyboard,
    });
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame || isRenameField(event.target)) return;
    event.preventDefault();
    // An open menu renders elsewhere in the page but reports here.
    if (!(event.target instanceof Element) || !frame.contains(event.target)) {
      return;
    }
    openMenu(
      event.target.closest<HTMLElement>("[data-item-id]"),
      event.clientX,
      event.clientY,
    );
  }

  // The keys for the focused row, or for one of its buttons. Keys from an
  // open menu, which renders elsewhere in the page, are the menu's.
  function onShortcut(event: KeyboardEvent<HTMLDivElement>) {
    const shortcut = navigatorShortcut(event.nativeEvent);
    const { target } = event;
    const frame = frameRef.current;
    if (!shortcut || !frame || !(target instanceof Element)) return;
    if (!frame.contains(target) || dragAndDropHooks.isVirtualDragging?.()) {
      return;
    }
    const row = target.closest<HTMLElement>("[data-item-id]");
    const node = (row && nodes.get(row.dataset.itemId ?? "")) || null;
    if (shortcut === "menu") {
      event.preventDefault();
      event.stopPropagation();
      openMenu(row);
      return;
    }
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    run(shortcut, node);
  }

  // The rename field's keys, presses, and focus belong to it. The tree's
  // rows handle keys in their capture phase, moving focus between rows,
  // selecting, and finding titles by typing, so the field's events are
  // stopped here, above the tree, before any row sees them. The navigator's
  // own shortcuts are taken here too, before a row can move focus on them.
  function stopForField(event: SyntheticEvent) {
    if (isRenameField(event.target)) event.stopPropagation();
  }
  const fieldHandlers = {
    onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
      const field = event.target;
      if (!isRenameField(field)) {
        onShortcut(event);
        return;
      }
      if (event.key === "Tab") return;
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
                <Button slot="drag" className={styles.rowButton}>
                  <GripVertical aria-hidden size={14} />
                </Button>
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
                      items={items ?? []}
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
          data-focus-target=""
          selectionMode="single"
          disallowEmptySelection
          // The selection is the open document, which Escape never clears,
          // so Escape reaches a pane over the page and closes it.
          escapeKeyBehavior="none"
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
          dragAndDropHooks={dragAndDropHooks}
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
              items={items}
              focusOnOpen={contextMenu.fromKeyboard ? "first" : "menu"}
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
      {moving ? (
        <MoveDialog
          node={moving}
          roots={roots}
          onMove={(parentId) => move(moving, { parentId, beforeId: null })}
          onClose={() => setMoving(null)}
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

// The commands for a row, or for the top level when node is null. Like any
// menu, it takes focus as it opens: a menu trigger chooses where itself,
// and a context menu passes focusOnOpen, focusing its first command when
// raised from the keyboard.
function ItemMenu({
  node,
  items,
  focusOnOpen,
  onCommand,
}: {
  node: TreeNode | null;
  items: WorkspaceItem[];
  focusOnOpen?: "first" | "menu";
  onCommand: (command: Command) => void;
}) {
  const isFolder = node?.kind === "folder";
  const keys = navigatorKeys();
  const disabled: Command[] = [];
  if (node && !siblingPlacement(items, node.id, "up")) disabled.push("moveUp");
  if (node && !siblingPlacement(items, node.id, "down")) {
    disabled.push("moveDown");
  }
  return (
    <Menu
      className={styles.menu}
      aria-label={node ? `Actions for ${node.title}` : "Workspace actions"}
      disabledKeys={disabled}
      {...(focusOnOpen
        ? { autoFocus: focusOnOpen === "first" ? "first" : true }
        : {})}
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
        <CommandItem id="rename" label="Rename" keys={keys.rename} />
      ) : null}
      {node ? <Separator className={styles.separator} /> : null}
      {node ? (
        <CommandItem id="moveUp" label="Move up" keys={keys.moveUp} />
      ) : null}
      {node ? (
        <CommandItem id="moveDown" label="Move down" keys={keys.moveDown} />
      ) : null}
      {node ? (
        <MenuItem id="moveTo" className={styles.menuItem}>
          Move to…
        </MenuItem>
      ) : null}
      {node ? <Separator className={styles.separator} /> : null}
      {node ? (
        <CommandItem id="delete" label="Delete…" keys={keys.delete} />
      ) : null}
    </Menu>
  );
}

// A menu command that shows the key that runs it from the tree. The key is
// the command's description, hidden from its name, which comes from its
// content rather than a label, so its name still holds all its visible
// label, as WCAG 2.5.3 requires.
function CommandItem({
  id,
  label,
  keys,
}: {
  id: Command;
  label: string;
  keys: Keys;
}) {
  return (
    <MenuItem id={id} textValue={label} className={styles.menuItem}>
      {label}
      <Keyboard className={styles.shortcut} aria-hidden>
        {keyLabel(keys)}
      </Keyboard>
    </MenuItem>
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
