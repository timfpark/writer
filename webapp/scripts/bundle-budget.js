// Checks the built webapp against ADR 0008's bundle budget: the editor's
// chunk, loaded when a document opens, within 160 KB gzipped, and all
// JavaScript for an open document within 400 KB gzipped. Reads the Vite
// manifest that `npm run build` writes. Exits 1 when a budget is exceeded
// and 2 when the build output is missing.
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const KB = 1000;
const editorBudget = 160 * KB;
const documentBudget = 400 * KB;
const editorSource = "src/editor/DocumentEditor.tsx";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifestPath = `${dist}.vite/manifest.json`;

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(
    `budget: cannot read ${manifestPath} (${error.message}); run npm run build first`,
  );
  process.exit(2);
}

// The JavaScript files a chunk loads before it runs: itself and its static
// imports, transitively.
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const chunk = manifest[key];
  if (!chunk) {
    console.error(`budget: ${manifestPath} names no chunk ${key}`);
    process.exit(2);
  }
  seen.add(key);
  for (const imported of chunk.imports ?? []) closure(imported, seen);
  return seen;
}

function gzipped(keys) {
  let total = 0;
  for (const key of keys) {
    const file = manifest[key].file;
    if (file.endsWith(".js")) {
      total += gzipSync(readFileSync(`${dist}${file}`)).length;
    }
  }
  return total;
}

const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
if (entries.length !== 1) {
  console.error(
    `budget: expected one entry in ${manifestPath}, found ${entries.length}`,
  );
  process.exit(2);
}
if (!manifest[editorSource]?.isDynamicEntry) {
  console.error(
    `budget: ${editorSource} is not a dynamically imported chunk in ${manifestPath}`,
  );
  process.exit(1);
}

const shell = closure(entries[0]);
const editor = [...closure(editorSource)].filter((key) => !shell.has(key));
const shellSize = gzipped(shell);
const editorSize = gzipped(editor);
const documentSize = shellSize + editorSize;

const format = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
const rows = [
  ["Editor chunk", editorSize, editorBudget],
  ["Open document", documentSize, documentBudget],
];
let failed = false;
console.log(`budget: shell and navigator ${format(shellSize)} gzipped`);
for (const [name, size, budget] of rows) {
  const over = size > budget;
  failed ||= over;
  console.log(
    `budget: ${name} ${format(size)} of ${format(budget)} gzipped${over ? " EXCEEDED" : ""}`,
  );
}
process.exit(failed ? 1 : 0);
