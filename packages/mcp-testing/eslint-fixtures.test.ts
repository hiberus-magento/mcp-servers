// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Mirrors `packages/mcp-core/eslint-fixtures.test.ts` (read-only): proves
// the fd-1 hazard boundary rule in `eslint.config.js` — banning
// `stdio: "inherit"` under `packages/**/src/**` — actually fires, by
// running ESLint programmatically over the deliberately-violating fixture
// in `eslint-fixtures/`.
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
describe("fd-1 hazard boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags stdio: \"inherit\" with no-restricted-syntax", async () => {
    const result = await lintFixture("./eslint-fixtures/stdio-inherit-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-syntax");
  });

  it("does not flag the permanent probe harness that legitimately uses stdio: \"inherit\"", async () => {
    const result = await lintFixture("./src/conformance/fd1-probe-harness.mjs");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain("no-restricted-syntax");
  });
});
