import { describe, expect, it } from "vitest";
import type { WorkspaceItem } from "./client";
import {
  ancestorIds,
  applyChange,
  applyChanges,
  buildTree,
  dropPlacement,
  siblingPlacement,
  subtreeIds,
} from "./workspaceTree";

// A synthetic pre-order tree:
// part (folder)
//   scene (folder)
//     draft (document)
//   notes (document)
// epilogue (document)
const items: WorkspaceItem[] = [
  { id: "part", kind: "folder", parentId: null, title: "Part" },
  { id: "scene", kind: "folder", parentId: "part", title: "Scene" },
  { id: "draft", kind: "document", parentId: "scene", title: "Draft" },
  { id: "notes", kind: "document", parentId: "part", title: "Notes" },
  { id: "epilogue", kind: "document", parentId: null, title: "Epilogue" },
];

const ids = (list: WorkspaceItem[]) => list.map((item) => item.id);

function create(parentId: string | null, beforeId: string | null) {
  return {
    type: "create",
    kind: "document",
    id: "new",
    parentId,
    beforeId,
    title: "New",
  } as const;
}

function move(id: string, parentId: string | null, beforeId: string | null) {
  const kind = items.find((item) => item.id === id)?.kind ?? "document";
  return { type: "move", kind, id, parentId, beforeId } as const;
}

describe("applyChange", () => {
  it("places a created item last inside its folder, after the folder's subtree", () => {
    expect(ids(applyChange(items, create("part", null)))).toEqual([
      "part",
      "scene",
      "draft",
      "notes",
      "new",
      "epilogue",
    ]);
    expect(ids(applyChange(items, create(null, null))).at(-1)).toBe("new");
  });

  it("places a created item before the named sibling", () => {
    expect(ids(applyChange(items, create("part", "notes")))).toEqual([
      "part",
      "scene",
      "draft",
      "new",
      "notes",
      "epilogue",
    ]);
  });

  it("ignores a create the workspace contradicts", () => {
    expect(applyChange(items, create("missing", null))).toBe(items);
    expect(applyChange(items, create("draft", null))).toBe(items);
    expect(applyChange(items, create(null, "notes"))).toBe(items);
  });

  it("changes nothing when a change has already taken effect", () => {
    const created = applyChange(items, create(null, null));
    expect(applyChange(created, create(null, null))).toBe(created);
    const rename = {
      type: "rename",
      kind: "document",
      id: "notes",
      title: "Renamed",
    } as const;
    const renamed = applyChange(items, rename);
    expect(renamed.find((item) => item.id === "notes")?.title).toBe("Renamed");
    expect(applyChange(renamed, rename)).toBe(renamed);
    const remove = { type: "delete", kind: "folder", id: "part" } as const;
    const removed = applyChange(items, remove);
    expect(applyChange(removed, remove)).toBe(removed);
  });

  it("deletes a folder with its whole subtree", () => {
    expect(
      ids(applyChange(items, { type: "delete", kind: "folder", id: "part" })),
    ).toEqual(["epilogue"]);
  });

  it("moves an item with its subtree into another parent or position", () => {
    const toTop = applyChange(items, move("scene", null, "part"));
    expect(ids(toTop)).toEqual(["scene", "draft", "part", "notes", "epilogue"]);
    expect(toTop[0]?.parentId).toBeNull();
    expect(toTop[1]?.parentId).toBe("scene");
    expect(ids(applyChange(items, move("epilogue", "scene", null)))).toEqual([
      "part",
      "scene",
      "draft",
      "epilogue",
      "notes",
    ]);
    expect(ids(applyChange(items, move("notes", "part", "scene")))).toEqual([
      "part",
      "notes",
      "scene",
      "draft",
      "epilogue",
    ]);
  });

  it("ignores a move into the item's own subtree or one that changes nothing", () => {
    expect(applyChange(items, move("part", "scene", null))).toBe(items);
    expect(applyChange(items, move("part", "part", null))).toBe(items);
    expect(applyChange(items, move("notes", "part", "notes"))).toBe(items);
    expect(applyChange(items, move("notes", "part", null))).toBe(items);
    expect(applyChange(items, move("scene", "part", "notes"))).toBe(items);
    expect(applyChange(items, move("notes", "missing", null))).toBe(items);
  });

  it("applies pending changes in order, so later ones build on earlier ones", () => {
    const result = applyChanges(items, [
      { ...create("scene", null), kind: "folder" },
      { type: "rename", kind: "folder", id: "new", title: "Named" },
    ]);
    expect(result.find((item) => item.id === "new")).toEqual({
      id: "new",
      kind: "folder",
      parentId: "scene",
      title: "Named",
    });
  });
});

describe("tree helpers", () => {
  it("nests items in order with their levels", () => {
    const [part, epilogue] = buildTree(items);
    expect(part?.children.map((node) => node.id)).toEqual(["scene", "notes"]);
    expect(part?.children[0]?.children[0]).toMatchObject({
      id: "draft",
      level: 3,
    });
    expect(epilogue?.level).toBe(1);
  });

  it("finds an item's subtree and its ancestors", () => {
    expect(subtreeIds(items, "part")).toEqual([
      "part",
      "scene",
      "draft",
      "notes",
    ]);
    expect(ancestorIds(items, "draft")).toEqual(["scene", "part"]);
    expect(ancestorIds(items, "epilogue")).toEqual([]);
    expect(ancestorIds(items, "missing")).toBeUndefined();
  });

  it("turns a drop before, on, or after a row into a placement", () => {
    const none = new Set<string>();
    expect(dropPlacement(items, "notes", "before", none)).toEqual({
      parentId: "part",
      beforeId: "notes",
    });
    expect(dropPlacement(items, "scene", "on", none)).toEqual({
      parentId: "scene",
      beforeId: null,
    });
    expect(dropPlacement(items, "draft", "on", none)).toBeUndefined();
    expect(dropPlacement(items, "scene", "after", none)).toEqual({
      parentId: "part",
      beforeId: "notes",
    });
    // After a row whose next sibling is the moved item, it skips that item.
    expect(dropPlacement(items, "scene", "after", new Set(["notes"]))).toEqual({
      parentId: "part",
      beforeId: null,
    });
    expect(dropPlacement(items, "epilogue", "after", none)).toEqual({
      parentId: null,
      beforeId: null,
    });
  });

  it("swaps an item with its previous or next sibling", () => {
    expect(siblingPlacement(items, "notes", "up")).toEqual({
      parentId: "part",
      beforeId: "scene",
    });
    expect(siblingPlacement(items, "scene", "down")).toEqual({
      parentId: "part",
      beforeId: null,
    });
    expect(siblingPlacement(items, "part", "down")).toEqual({
      parentId: null,
      beforeId: null,
    });
    expect(siblingPlacement(items, "scene", "up")).toBeUndefined();
    expect(siblingPlacement(items, "notes", "down")).toBeUndefined();
  });
});
