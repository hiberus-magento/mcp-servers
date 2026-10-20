// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Mirrors `packages/mcp-core/eslint-fixtures.test.ts` (read-only): proves
// the client-boundary `no-restricted-imports` rule fires against a REAL
// deep import into `packages/eds/src/client/http.ts`, naming `client/index`
// in the violation message (eds-client spec, "Client Boundary Import").
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

// The explicit timeouts in this file bound a HANG, not the linter's speed:
// what these cases assert is that the rule fires, never how long ESLint
// takes to load the root config and typescript-eslint. That load costs
// ~0.5 s idle and was measured past vitest's 5 s default on a contended
// machine, which failed the run on a limit asserting nothing about the rule.
describe("eds client-boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a deep import into packages/eds/src/client/http.ts with no-restricted-imports", async () => {
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

describe("eds cli.ts stdout exemption is scoped, not a repo-wide leak", { timeout: 120_000 }, () => {
  it("flags a direct process.stdout write in an ordinary source file", async () => {
    const result = await lintFixture("./eslint-fixtures/stdout-write-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-properties");
  });

  it("does NOT flag cli.ts's own process.stdout.write — the one exempted entrypoint", async () => {
    const eslint = new ESLint({
      overrideConfigFile: ROOT_CONFIG_PATH,
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
    });
    const results = await eslint.lintFiles([fileURLToPath(new URL("./src/cli.ts", import.meta.url))]);
    const result = results[0];
    if (!result) {
      throw new Error("eslint produced no result for src/cli.ts");
    }
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).not.toContain("no-restricted-properties");
  });
});
