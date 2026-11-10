// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// Packaging gate, rung (b) (design.md, Decision 1): `@modelcontextprotocol/sdk`'s
// stdio path statically imports `ajv`/`ajv-formats` and would otherwise pull
// ~1 MB of validator code into a stdio-only bundle that never uses it. These
// aliases are safe only because `src/mcp.ts` always supplies an explicit
// `jsonSchemaValidator`, so the real constructors these stubs replace never run.
const ajvStub = fileURLToPath(new URL("../mcp-core/src/stubs/ajv.js", import.meta.url));
const ajvFormatsStub = fileURLToPath(new URL("../mcp-core/src/stubs/ajv-formats.js", import.meta.url));

// The version this server announces over `initialize`, substituted into
// `mcp-core`'s `serverVersion()` at build time. It used to be a literal
// "0.0.0" in the server source while the package shipped at 0.1.0, so the
// server gave a confident wrong answer to "which version am I running".
// Read from THIS package's own package.json, which is the one `changeset
// version` rewrites — there is no second place to keep in step. The shared
// conformance suite asserts the two still agree, on the built bundle.
const packageVersion: string = createRequire(import.meta.url)("./package.json").version;

export default defineConfig({
  // Two binaries, one dist/ (G1 correction, tasks.md 9.3): the amended
  // packaging gate asserts "one bundled file per declared bin", not
  // "exactly one file total" — so `hiberus-aem-sites` (cli.ts) and
  // `hiberus-aem-sites-mcp` (mcp.ts) build side by side into the same `dist/`,
  // matching the founding brief's reference package shape.
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
  define: {
    __MCP_SERVER_VERSION__: JSON.stringify(packageVersion),
  },
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      ajv: ajvStub,
      "ajv-formats": ajvFormatsStub,
    };
  },
});
