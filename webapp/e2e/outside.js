// Edits a document's file in the browser test run's data folder, as another
// program would, for tests of edits made outside Writer. The folder is the
// one scripts/e2e-service.js creates for the service's port, laid out as
// ADR 0006 describes.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function findPath(items, documentId) {
  for (const item of items) {
    if (item.id === documentId) return [item.name];
    if (item.items) {
      const inside = findPath(item.items, documentId);
      if (inside) return [item.name, ...inside];
    }
  }
  return undefined;
}

export function writeDocumentFile(servicePort, documentId, markdown) {
  const workspace = join(tmpdir(), `writer-e2e-${servicePort}`, "workspace");
  const index = JSON.parse(
    readFileSync(join(workspace, ".writer", "workspace.json"), "utf8"),
  );
  const path = findPath(index.items, documentId);
  if (!path) {
    throw new Error(`no document ${documentId} in ${workspace}`);
  }
  writeFileSync(join(workspace, ...path), markdown);
}
