// Runs the service for one browser test run, which playwright.config.ts starts
// with WRITER_PORT set. Each run gets a new, empty data folder, removed when
// the service stops, so runs never share or keep a workspace.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const serviceDir = fileURLToPath(new URL("../../service/", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "writer-e2e-"));

function removeDataDir() {
  rmSync(dataDir, { recursive: true, force: true });
}

const service = spawn(
  "cargo",
  ["run", "--locked", "--quiet", "-p", "writer-server"],
  {
    cwd: serviceDir,
    stdio: "inherit",
    env: { ...process.env, WRITER_DATA_DIR: dataDir },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => service.kill(signal));
}

service.on("error", (error) => {
  console.error(
    `e2e-service: could not run cargo in ${serviceDir} (${error.message}); install rustup so cargo is on PATH`,
  );
  removeDataDir();
  process.exit(2);
});

service.on("exit", (code) => {
  removeDataDir();
  process.exit(code ?? 1);
});
