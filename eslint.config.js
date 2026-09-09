// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const LICENSE_HEADER_TEXT = "Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.";

// Small inline plugin instead of an npm dependency: the check is a single
// exact-string comparison against the first comment(s) in the file, so a
// third-party rule buys nothing but an extra dependency to license-audit.
const licenseHeaderPlugin = {
  rules: {
    "require-header": {
      meta: {
        type: "problem",
        docs: {
          description: "Require the Apache-2.0 copyright header comment at the top of every source file.",
        },
        schema: [],
        messages: {
          missing: `Missing the required header comment "// ${LICENSE_HEADER_TEXT}" at the top of the file.`,
        },
      },
      create(context) {
        return {
          Program(node) {
            const sourceCode = context.sourceCode;
            // Look at the first two comments, not just the first, so a
            // shebang line (`#!/usr/bin/env node`, itself sometimes surfaced
            // as a leading comment node by the parser) never defeats the check.
            const headerPresent = sourceCode
              .getAllComments()
              .slice(0, 2)
              .some((comment) => comment.value.trim() === LICENSE_HEADER_TEXT);
            if (!headerPresent) {
              context.report({ node, messageId: "missing" });
            }
          },
        };
      },
    },
  },
};

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
    },
  },
  {
    // `no-restricted-properties` bans direct `process.stdout` access
    // everywhere EXCEPT `packages/mcp-core/src/bootstrap/**`, which is the
    // one place allowed to touch it: it IS the stdout-diversion mechanism
    // (design.md, Decision 2, M1). Every other package must go through the
    // exported logger instead.
    files: ["packages/**/src/**/*.{ts,tsx}"],
    ignores: ["packages/mcp-core/src/bootstrap/**"],
    rules: {
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
    // SDK boundary + client boundary: both enforced by `no-restricted-imports`
    // on overlapping file sets, so they MUST live in the same rule
    // invocation rather than two separate config blocks. Flat config merges
    // same-named rules per file by last-match-wins, not by union — a second
    // block declaring its own `no-restricted-imports` for
    // `packages/**/src/**` would silently replace this one wherever the two
    // globs overlap (see Phase 9's mcp-testing checkpoint for where this bug
    // was first hit and fixed).
    //
    // SDK boundary: only packages/mcp-core/src may reach into
    // @modelcontextprotocol/sdk's barrel or its server/index.js — that deep
    // path is the one that statically pulls in express/hono/ajv/etc (see
    // design.md, Decision 1). Every other package must go through the
    // mcp-core bootstrap instead.
    //
    // Client boundary (design.md, Decision 6): code outside a package's own
    // `client/` directory must import another package's client surface only
    // through its public `client/index.ts`/`client/index.js` entrypoint,
    // never a deeper path. No domain package has a `client/` directory yet —
    // this is fixture-proven ahead of `eds-package` exercising it for real.
    //
    // `eslint-fixtures/**` is intentionally covered too: it holds
    // deliberately-violating files asserted against programmatically in
    // `eslint-fixtures.test.ts`, proving both rules actually fire before any
    // package outside mcp-core exists yet.
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
            {
              group: ["**/client/**", "!**/client/index.js", "!**/client/index.ts"],
              message:
                "Import another package's public client entrypoint only (client/index.ts) — deep client/ paths are not part of the public contract.",
            },
          ],
        },
      ],
    },
  },
  {
    // License-header rule (design.md, Decision 6 / workspace-scaffolding
    // spec). Scoped to every real source file repo-wide; `eslint-fixtures/**`
    // is included too so `missing-license-header.ts` proves the rule fires.
    // Config/build files that intentionally have no header (package.json,
    // tsconfig.json, markdown, generated output) are not matched by these
    // globs to begin with, so no explicit `ignores` is needed beyond the
    // global ignore block above.
    files: ["packages/**/*.{ts,tsx,js,mjs,cjs}", "scripts/**/*.mjs", "templates/**/*.{ts,tsx,js,mjs,cjs}", "*.{js,mjs,cjs}"],
    plugins: {
      "license-header": licenseHeaderPlugin,
    },
    rules: {
      "license-header/require-header": "error",
    },
  },
  {
    // Exec boundary (design.md, Decision 4): `execFile` — never `exec`,
    // `execSync`, or `spawnSync` — is the only process-spawn primitive
    // `mcp-core/src/exec/**` may use, and prefix/regex allowlist matching
    // can never be reintroduced there. Only the two exec-specific fixtures
    // are covered here — not the whole `eslint-fixtures/**` directory —
    // because a broader glob would overwrite the SDK-boundary block's
    // `no-restricted-imports` config for the SDK fixture (flat config
    // merges same-named rules per file by last-match-wins, not by union).
    files: [
      "packages/mcp-core/src/exec/**/*.{ts,tsx}",
      "packages/mcp-core/eslint-fixtures/exec-import-violation.ts",
      "packages/mcp-core/eslint-fixtures/prefix-match-violation.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              importNames: ["exec", "execSync", "spawnSync"],
              message:
                "Use execFile only under packages/mcp-core/src/exec/** — never exec, execSync, or spawnSync (design.md, Decision 4).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='RegExp']",
          message:
            "Regex allowlist matching is banned under src/exec/** — use an exact Map lookup (design.md, Decision 4).",
        },
        {
          selector: "Literal[regex]",
          message:
            "Regex literals are banned under src/exec/** — use an exact Map lookup (design.md, Decision 4).",
        },
        {
          selector: "CallExpression[callee.property.name='startsWith']",
          message:
            "Prefix matching (.startsWith) is banned under src/exec/** — use an exact Map lookup (design.md, Decision 4).",
        },
        {
          selector: "CallExpression[callee.property.name='includes']",
          message:
            "Substring matching (.includes) is banned under src/exec/** — use an exact Map lookup (design.md, Decision 4).",
        },
        {
          selector: "CallExpression[callee.property.name='test']",
          message:
            "Regex .test() is banned under src/exec/** — use an exact Map lookup (design.md, Decision 4).",
        },
      ],
    },
  },
  {
    // fd-1 hazard boundary (eds-package design.md, Decision 1): `stdio:
    // "inherit"` hands a spawned child this process's raw file descriptors,
    // bypassing the in-process stdout guard (M1) entirely — exactly the M4
    // hazard the domain-independent conformance probe exists to catch. The
    // one legitimate use in this repository is the probe itself,
    // `fd1-probe-harness.mjs`, which needs the real hazard to prove its
    // positive control has teeth.
    //
    // `ignores` also carves out `packages/mcp-core/src/exec/**` and its two
    // dedicated fixtures: those paths already carry their own
    // `no-restricted-syntax` array in the exec-boundary block above, and
    // flat config merges same-named rules per file by last-match-wins, not
    // by union — letting this broader block also reach them would silently
    // replace that array instead of adding to it (the exact bug class this
    // file already documents at the exec-boundary block).
    files: ["packages/**/src/**/*.{ts,tsx,js,mjs,cjs}", "packages/*/eslint-fixtures/**/*.{ts,tsx}"],
    ignores: [
      "packages/mcp-core/src/exec/**",
      "packages/mcp-core/eslint-fixtures/exec-import-violation.ts",
      "packages/mcp-core/eslint-fixtures/prefix-match-violation.ts",
      "packages/mcp-testing/src/conformance/fd1-probe-harness.mjs",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='stdio'][value.value='inherit']",
          message:
            "stdio: \"inherit\" is banned under packages/**/src/** — it hands a spawned child this process's raw file descriptors, bypassing the stdout guard. Use \"pipe\" instead (design.md, Decision 1). The one exception is fd1-probe-harness.mjs, the domain-independent purity probe itself.",
        },
      ],
    },
  },
);
