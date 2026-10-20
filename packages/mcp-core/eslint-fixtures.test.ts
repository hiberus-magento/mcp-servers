// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Proves the lint rules under `eslint.config.js` that guard code which does
// not exist yet actually fire, by running ESLint programmatically over the
// deliberately-violating fixtures in `eslint-fixtures/`. Extended in later
// phases as more boundary/exec/license-header fixtures are added.
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
describe("SDK-boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a server/index.js deep import outside packages/mcp-core/src with no-restricted-imports", async () => {
    const result = await lintFixture("./eslint-fixtures/sdk-deep-import-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("does not flag the fixture's own re-export as any other unrelated boundary rule", async () => {
    const result = await lintFixture("./eslint-fixtures/sdk-deep-import-violation.ts");
    const restrictedImportMessages = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
    expect(restrictedImportMessages).toHaveLength(1);
    expect(restrictedImportMessages[0]?.message).toContain("server/index.js");
  });
});

describe("exec-boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a node:child_process exec import with no-restricted-imports", async () => {
    const result = await lintFixture("./eslint-fixtures/exec-import-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("flags .startsWith prefix matching with no-restricted-syntax", async () => {
    const result = await lintFixture("./eslint-fixtures/prefix-match-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-syntax");
  });
});

describe("client-boundary eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a deep import into another package's client/ directory with no-restricted-imports", async () => {
    const result = await lintFixture("./eslint-fixtures/deep-client-import-violation.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("names the client boundary in the violation message, not the SDK-barrel one", async () => {
    const result = await lintFixture("./eslint-fixtures/deep-client-import-violation.ts");
    const restrictedImportMessages = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
    expect(restrictedImportMessages).toHaveLength(1);
    expect(restrictedImportMessages[0]?.message).toContain("client/index");
  });
});

describe("license-header eslint-fixtures", { timeout: 120_000 }, () => {
  it("flags a source file missing the Apache-2.0 header with license-header/require-header", async () => {
    const result = await lintFixture("./eslint-fixtures/missing-license-header.ts");
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("license-header/require-header");
  });
});
