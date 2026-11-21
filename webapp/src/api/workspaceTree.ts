import type { ItemKind, WorkspaceItem } from "./client";

// A change the writer makes to the tree. Each one is applied to the cached
// tree by applyChange while its request is pending, and again when it
// succeeds, so applying a change that has already taken effect changes nothing.
export type TreeChange =
  | {
      type: "create";
      kind: ItemKind;
      id: string;
      parentId: string | null;
      beforeId: string | null;
      title: string;
      // A new document's content, which is empty when omitted.
      markdown?: string;
    }
  | { type: "rename"; kind: ItemKind; id: string; title: string }
  | {
      type: "move";
      kind: ItemKind;
      id: string;
      parentId: string | null;
      beforeId: string | null;
    }
  | { type: "delete"; kind: ItemKind; id: string };

export interface TreeNode {
  id: string;
  kind: ItemKind;
  title: string;
  parentId: string | null;
  level: number;
  children: TreeNode[];
}

// The index just past an item's subtree, which is contiguous in pre-order.
function subtreeEnd(items: WorkspaceItem[], index: number): number {
  const inside = new Set([items[index]?.id]);
  let end = index + 1;
  for (; end < items.length; end++) {
    const parentId = items[end]?.parentId;
    if (parentId === null || parentId === undefined || !inside.has(parentId))
      break;
    inside.add(items[end]?.id);
  }
  return end;
}

// Where ADR 0005's placement puts a new child of parentId: before beforeId,
// or after the parent's last descendant. Undefined when the workspace
// contradicts the placement, which the service answers with 409.
function insertionIndex(
  items: WorkspaceItem[],
  parentId: string | null,
  beforeId: string | null,
): number | undefined {
  if (beforeId !== null) {
    const index = items.findIndex(
      (item) => item.id === beforeId && item.parentId === parentId,
    );
    return index === -1 ? undefined : index;
  }
  if (parentId === null) return items.length;
  const parent = items.findIndex(
    (item) => item.id === parentId && item.kind === "folder",
  );
  return parent === -1 ? undefined : subtreeEnd(items, parent);
}

// Applies one change to a pre-order item list, following ADR 0005's rules,
// and returns the same list when the change does not apply.
export function applyChange(
  items: WorkspaceItem[],
  change: TreeChange,
): WorkspaceItem[] {
  const index = items.findIndex((item) => item.id === change.id);
  if (change.type === "create") {
    if (index !== -1) return items;
    const at = insertionIndex(items, change.parentId, change.beforeId);
    if (at === undefined) return items;
    const created: WorkspaceItem = {
      id: change.id,
      kind: change.kind,
      parentId: change.parentId,
      title: change.title,
    };
    return [...items.slice(0, at), created, ...items.slice(at)];
  }
  if (change.type === "rename") {
    const item = items[index];
    if (!item || item.title === change.title) return items;
    return items.map((other) =>
      other === item ? { ...item, title: change.title } : other,
    );
  }
  if (change.type === "move") return move(items, index, change);
  if (index === -1) return items;
  return [...items.slice(0, index), ...items.slice(subtreeEnd(items, index))];
}

// Moves the item at index and its subtree to ADR 0005's placement. A move
// the service would refuse, such as into the item's own subtree, or one that
// leaves the tree as it was, returns the same list.
function move(
  items: WorkspaceItem[],
  index: number,
  change: Extract<TreeChange, { type: "move" }>,
): WorkspaceItem[] {
  const item = items[index];
  if (!item || change.beforeId === change.id) return items;
  const end = subtreeEnd(items, index);
  const moved = items.slice(index, end);
  if (moved.some((inside) => inside.id === change.parentId)) return items;
  const rest = [...items.slice(0, index), ...items.slice(end)];
  const at = insertionIndex(rest, change.parentId, change.beforeId);
  if (at === undefined) return items;
  if (item.parentId === change.parentId && at === index) return items;
  return [
    ...rest.slice(0, at),
    { ...item, parentId: change.parentId },
    ...moved.slice(1),
    ...rest.slice(at),
  ];
}

const changeTypes = new Set<unknown>(["create", "rename", "move", "delete"]);

// Whether a mutation's variables are a tree change.
export function isTreeChange(value: unknown): value is TreeChange {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    changeTypes.has(value.type)
  );
}

export function applyChanges(
  items: WorkspaceItem[],
  changes: TreeChange[],
): WorkspaceItem[] {
  return changes.reduce(applyChange, items);
}

// Nests a pre-order item list, keeping each parent's order.
export function buildTree(items: WorkspaceItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const nodes = new Map<string, TreeNode>();
  for (const item of items) {
    const parent =
      item.parentId === null ? undefined : nodes.get(item.parentId);
    if (item.parentId !== null && !parent) continue;
    const node: TreeNode = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      parentId: item.parentId,
      level: parent ? parent.level + 1 : 1,
      children: [],
    };
    nodes.set(item.id, node);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

// The identifiers of an item and everything below it, in pre-order.
export function subtreeIds(items: WorkspaceItem[], id: string): string[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return [];
  return items.slice(index, subtreeEnd(items, index)).map((item) => item.id);
}

export interface Placement {
  parentId: string | null;
  beforeId: string | null;
}

// ADR 0007's placement for a drop: before a row places the item before it,
// on a folder places it last inside, and after a row places it before that
// row's next sibling other than the moved items, or last when there is none.
// Undefined when the row is missing or a drop on it would not be inside a
// folder.
export function dropPlacement(
  items: WorkspaceItem[],
  targetId: string,
  position: "before" | "on" | "after",
  movedIds: ReadonlySet<string>,
): Placement | undefined {
  const target = items.find((item) => item.id === targetId);
  if (!target) return undefined;
  if (position === "on") {
    return target.kind === "folder"
      ? { parentId: target.id, beforeId: null }
      : undefined;
  }
  const { parentId } = target;
  if (position === "before") return { parentId, beforeId: target.id };
  const siblings = items.filter((item) => item.parentId === parentId);
  const after = siblings.slice(siblings.indexOf(target) + 1);
  const next = after.find((item) => !movedIds.has(item.id));
  return { parentId, beforeId: next?.id ?? null };
}

// The placement that swaps an item with its previous or next sibling, or
// undefined when it is already first or last.
export function siblingPlacement(
  items: WorkspaceItem[],
  id: string,
  direction: "up" | "down",
): Placement | undefined {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return undefined;
  const { parentId } = item;
  const siblings = items.filter((candidate) => candidate.parentId === parentId);
  const index = siblings.indexOf(item);
  if (direction === "up") {
    const previous = siblings[index - 1];
    return previous ? { parentId, beforeId: previous.id } : undefined;
  }
  if (index === siblings.length - 1) return undefined;
  return { parentId, beforeId: siblings[index + 2]?.id ?? null };
}

// The folders that contain an item, nearest first, or undefined when the
// item is not in the tree.
export function ancestorIds(
  items: WorkspaceItem[],
  id: string,
): string[] | undefined {
  const byId = new Map(items.map((item) => [item.id, item]));
  let item = byId.get(id);
  if (!item) return undefined;
  const ancestors: string[] = [];
  while (item.parentId !== null) {
    ancestors.push(item.parentId);
    const parent = byId.get(item.parentId);
    if (!parent) break;
    item = parent;
  }
  return ancestors;
}
