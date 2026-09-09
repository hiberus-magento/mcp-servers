// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Validates `servers.json` against `schema/servers.schema.json`
// (server-manifest spec, "servers.json as Single Source of Truth"). This
// module is a plain Node script, never bundled into any server's stdio
// transport — `ajv` here is unrelated to the `ajv`/`ajv-formats` alias-stub
// concern in `mcp-core`'s packaging gate (design.md, Decision 1), which is
// only about what a `tsup` bundle statically pulls in.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// `schema/servers.schema.json` declares a 2020-12 `$schema`; the default
// `ajv` export only understands draft-07. `ajv/dist/2020` is the same
// package's dedicated 2020-12 entrypoint.
import Ajv2020 from "ajv/dist/2020.js";

const SCHEMA_PATH = fileURLToPath(new URL("../schema/servers.schema.json", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../servers.json", import.meta.url));

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

/**
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateServersManifest(data) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(loadSchema());
  const valid = validate(data);
  const errors = (validate.errors ?? []).map(
    (error) => `${error.instancePath || "<root>"} ${error.message ?? "is invalid"}`.trim(),
  );
  return { valid: Boolean(valid), errors };
}

export function loadServersManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

async function main() {
  const manifest = loadServersManifest();
  const result = validateServersManifest(manifest);
  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`servers.json: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`servers.json: valid (${manifest.servers.length} server(s))`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
