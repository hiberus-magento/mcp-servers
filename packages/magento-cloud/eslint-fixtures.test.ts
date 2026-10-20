// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 9.10-9.11): mirrors `packages/aco/eslint-fixtures.test.ts`
// and `packages/mcp-core/eslint-fixtures.test.ts` (both read-only precedent)
// — proves the client-boundary `no-restricted-imports` rule fires against a
// REAL deep import into `packages/magento-cloud/src/client/classify.js`,
// naming `client/index` in the violation message. 9.11 is the GREEN half:
// this test passes with NO production change to `eslint.config.js` — its
// `packages/**/src/**` / `packages/*/eslint-fixtures/**` globs already
// cover this package, proving the boundary rule generalizes rather than
// needing a per-package carve-out.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT_CONFIG_PATH = fileURLToPath(new URL("../../eslint.config.js", import.meta.url));

async function lintFixture(relativeFixturePath: string) {
  const eslint = new ESLint({
    overrideConfigFile: ROOT_CONFIG_PATH,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    // The root config globally ignores `eslint-fixtures/**` so the normal
    // `eslint .` CI task never fails on these deliberately-violating files.
    // Disable that ignore here, since proving the rule fires against them
    // is the entire point of this test.
    ignore: false,
  });
  const fixturePath = fileURLToPath(new URL(relativeFixturePath, import.meta.url));
  const results = await eslint.lintFiles([fixturePath]);
  const result = results[0];
  if (!result) {
    throw new Error(`eslint produced no result for fixture: ${fixturePath}`);
  }
  return result;
}

// The explicit timeout bounds a HANG, not the linter's speed: what these
// cases assert is that the rule fires, never how long ESLint takes to load
// the root config and typescript-eslint. That load costs ~0.5 s idle and was
// measured past vitest's 5 s default on a contended machine, which failed
// the run on a limit that was asserting nothing about the boundary rule.
describe("magento-cloud client-boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a deep import into packages/magento-cloud/src/client/classify.ts with no-restricted-imports", async () => {
    const result = await lintFixture("./eslint-fixtures/deep-client-import.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("names the client boundary (client/index) in the violation message", async () => {
    const result = await lintFixture("./eslint-fixtures/deep-client-import.ts");
    const restrictedImportMessages = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
    expect(restrictedImportMessages.length).toBeGreaterThanOrEqual(1);
    expect(restrictedImportMessages.some((message) => message.message.includes("client/index"))).toBe(true);
  });
});
