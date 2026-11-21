// Reads and edits files in the browser test run's data folder, as another
// program would, for tests of where Writer keeps items and of edits made
// outside Writer. The folder is the one scripts/e2e-service.js creates for
// the service's port, laid out as ADR 0006 describes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function workspaceDir(servicePort) {
  return join(tmpdir(), `writer-e2e-${servicePort}`, "workspace");
}

function findPath(items, itemId) {
  for (const item of items) {
    if (item.id === itemId) return [item.name];
    if (item.items) {
      const inside = findPath(item.items, itemId);
      if (inside) return [item.name, ...inside];
    }
  }
  return undefined;
}

function pathOf(workspace, itemId) {
  const index = JSON.parse(
    readFileSync(join(workspace, ".writer", "workspace.json"), "utf8"),
  );
  const path = findPath(index.items, itemId);
  if (!path) {
    throw new Error(`no item ${itemId} in ${workspace}`);
  }
  return path;
}

// The names of the directories and file that hold an item, from the
// workspace folder down, or undefined while the item is not there on disk,
// as during a move.
export function itemLocation(servicePort, itemId) {
  const workspace = workspaceDir(servicePort);
  const path = pathOf(workspace, itemId);
  return existsSync(join(workspace, ...path)) ? path : undefined;
}

export function writeDocumentFile(servicePort, documentId, markdown) {
  const workspace = workspaceDir(servicePort);
  writeFileSync(join(workspace, ...pathOf(workspace, documentId)), markdown);
}
