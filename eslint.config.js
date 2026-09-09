// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `eslint-fixtures/**` holds deliberately-violating files, excluded here
    // so `eslint .` (the CI lint task) never fails on them. They are linted
    // on purpose, with these global ignores disabled, by the `ESLint({ ignore: false })`
    // instance in each package's `eslint-fixtures.test.ts`.
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/eslint-fixtures/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything in this repo runs on Node. Plain JS/MJS files (build scripts,
    // flat configs, the alias stubs) are checked by `no-undef`, so they need the
    // Node globals declared. TypeScript files get theirs from @types/node, and
    // typescript-eslint disables `no-undef` for them because tsc already covers it.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/**/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "stdout",
          message:
            "Do not write to process.stdout directly — stdout is reserved for the JSON-RPC transport. Use the mcp-core logger, which writes to stderr.",
        },
      ],
    },
  },
  {
    // SDK boundary: only packages/mcp-core/src may reach into
    // @modelcontextprotocol/sdk's barrel or its server/index.js — that deep
    // path is the one that statically pulls in express/hono/ajv/etc (see
    // design.md, Decision 1). Every other package must go through the
    // mcp-core bootstrap instead. `eslint-fixtures/**` is intentionally
    // covered too: it holds deliberately-violating files asserted against
    // programmatically in `eslint-fixtures.test.ts`, proving this rule
    // actually fires before any package outside mcp-core exists yet.
    files: ["packages/**/src/**/*.{ts,tsx}", "packages/*/eslint-fixtures/**/*.{ts,tsx}"],
    ignores: ["packages/mcp-core/src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@modelcontextprotocol/sdk",
              message:
                "Import deep @modelcontextprotocol/sdk paths only from within packages/mcp-core/src. Application code must not depend on the SDK barrel.",
            },
          ],
          patterns: [
            {
              group: ["@modelcontextprotocol/sdk/server/index.js", "@modelcontextprotocol/sdk/server/index"],
              message:
                "Do not import @modelcontextprotocol/sdk's server/index.js directly outside packages/mcp-core/src — it statically pulls in express/hono/ajv/etc. Use the mcp-core bootstrap instead.",
            },
          ],
        },
      ],
    },
  },
);
