// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// Packaging gate, rung (b) (design.md, Decision 1): `@modelcontextprotocol/sdk`'s
// stdio path statically imports `ajv`/`ajv-formats` and would otherwise pull
// ~1 MB of validator code into a stdio-only bundle that never uses it. These
// aliases are safe only because `src/mcp.ts` always supplies an explicit
// `jsonSchemaValidator`, so the real constructors these stubs replace never run.
const ajvStub = fileURLToPath(new URL("../mcp-core/src/stubs/ajv.js", import.meta.url));
const ajvFormatsStub = fileURLToPath(new URL("../mcp-core/src/stubs/ajv-formats.js", import.meta.url));

export default defineConfig({
  // Two binaries, one dist/ (mirrors packages/eds/tsup.config.ts): the
  // packaging gate asserts "one bundled file per declared bin", not "exactly
  // one file total" — so `hiberus-aco` (cli.ts) and `hiberus-aco-mcp`
  // (mcp.ts) build side by side into the same dist/.
  entry: ["src/cli.ts", "src/mcp.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  minify: false,
  sourcemap: false,
  metafile: true,
  clean: true,
  dts: false,
  shims: false,
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      ajv: ajvStub,
      "ajv-formats": ajvFormatsStub,
    };
  },
});
