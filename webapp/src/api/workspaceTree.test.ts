import { describe, expect, it } from "vitest";
import type { WorkspaceItem } from "./client";
import {
  ancestorIds,
  applyChange,
  applyChanges,
  buildTree,
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
});
