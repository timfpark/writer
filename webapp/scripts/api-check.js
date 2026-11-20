// Fails when src/api/generated/schema.d.ts differs from what openapi-typescript
// generates from service/openapi.json, naming the file and the command that
// fixes it, which the generator's own message does not. Never writes. Run it
// through npm run api:check, which puts the generator on PATH.
import { spawnSync } from "node:child_process";
import process from "node:process";

const generated = "webapp/src/api/generated/schema.d.ts";
const result = spawnSync(
  "openapi-typescript",
  [
    "../service/openapi.json",
    "--output",
    "src/api/generated/schema.d.ts",
    "--check",
  ],
  { encoding: "utf8" },
);

if (result.error) {
  console.error(
    `api:check: could not run openapi-typescript (${result.error.message}); run npm ci in webapp/ first`,
  );
  process.exit(2);
}

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

if (result.status === 0) {
  process.exit(0);
}

if (`${result.stdout}${result.stderr}`.includes("not up-to-date")) {
  console.error(
    `api:check: ${generated} is out of date with service/openapi.json; run npm run api:generate in webapp/ and commit the result`,
  );
} else {
  console.error(
    `api:check: openapi-typescript could not check ${generated} against service/openapi.json; fix the error above, then run npm run api:generate in webapp/`,
  );
}
process.exit(1);
