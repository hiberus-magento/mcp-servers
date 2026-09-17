// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite (mcp-conformance spec) against the
// BUILT `hiberus-magento-cloud-mcp` bundle — the FIRST real caller of
// `shellOutProbe` and `readOnlyIntrospections` (design.md, Decision 9;
// added in change 2 for a pure-HTTPS package's sake; `eds`/`aco` both pass
// neither). Wired as an ordinary `turbo test` step with
// `dependsOn: ["build", "^build"]` (`turbo.json`), so the bundle always
// exists before this file runs.
//
// THE WIRING PROBLEM, verified rather than assumed (design.md): `describeConformance`
// constructs `JsonRpcClient` with no `env` (`conformance.ts:207`), and
// `JsonRpcClient` falls back to `sanitizedEnv()`, which forwards `PATH`
// ONLY (`jsonrpc-client.ts:44-50`) — `sanitizedEnv()` reads
// `process.env.PATH` LAZILY inside the constructor. So the built server can
// be handed the fake binary only through this file's OWN `process.env.PATH`,
// mutated at MODULE SCOPE before `describeConformance(...)` runs below, and
// restored in a file-level `afterAll`.
//
// CONFIRMED (tasks.md 9.4): the full package suite (222 tests across every
// file) was run TWICE in direct succession specifically to check for
// order-dependent leakage of this file's `process.env.PATH` mutation into
// another test file under the repo's default vitest pool — including files
// that also touch PATH indirectly (`locate-binary.test.ts`,
// `classify.timeout.test.ts`, `cli.test.ts`). Both runs were 222/222 green.
// No order-dependent failure was observed.
import { afterAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonRpcClient, checkReadOnlyIsolation, describeConformance } from "@hiberus-magento/mcp-testing";
import { createMagentoCloudAllowlist } from "./client/index.js";
import { readFileSync } from "node:fs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));
const FAKE_BIN_DIR = fileURLToPath(new URL("../test/fake-bin", import.meta.url));

const ORIGINAL_PATH = process.env.PATH;
process.env.PATH = `${FAKE_BIN_DIR}:${ORIGINAL_PATH ?? ""}`;

afterAll(() => {
  process.env.PATH = ORIGINAL_PATH;
});

// The probe's expected text equals the EXACT text Phase 1's canned
// `auth:info` fixture produces, once parsed and wrapped by
// `magentocloud_auth_status`'s own handler shape. A tool that did not spawn
// a real child could not produce this exact text — a passing probe is
// positive evidence that a real child process ran and its stdout was
// captured (design.md, Decision 9).
const AUTH_INFO_FIXTURE_TEXT = readFileSync(fileURLToPath(new URL("../test/fake-bin/fixtures/auth-info.txt", import.meta.url)), "utf8");

function parseKeyValueFixture(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [key, value] = line.split("\t");
    if (key !== undefined && value !== undefined) {
      record[key] = value;
    }
  }
  return record;
}

const EXPECTED_AUTH_STATUS_TEXT = JSON.stringify({ authenticated: true, account: parseKeyValueFixture(AUTH_INFO_FIXTURE_TEXT) });

const EXPECTED_TOOL_NAMES = [
  "magentocloud_auth_status",
  "magentocloud_describe_environment",
  "magentocloud_describe_project",
  "magentocloud_get_activities",
  "magentocloud_get_environment_config",
  "magentocloud_list_environments",
  "magentocloud_list_projects",
  "magentocloud_query_database",
] as const;

// `listCommandKeys()` needs a resolved bin path, but never actually spawns —
// it is pure registry introspection over the allowlist factory
// (`commands.ts`). Constructed IN THIS TEST PROCESS, since the real
// allowlist lives inside the spawned server process and cannot be
// introspected across the JSON-RPC boundary (design.md, Decision 9's stated
// limit: "a source-layer proof wearing a conformance hat").
const introspectionAllowlist = createMagentoCloudAllowlist(`${FAKE_BIN_DIR}/magento-cloud`);
const expectedCommandKeys = introspectionAllowlist.listCommandKeys();

describeConformance({
  serverPath,
  packageDir,
  shellOutProbe: {
    toolName: "magentocloud_auth_status",
    arguments: {},
    expectedResultText: EXPECTED_AUTH_STATUS_TEXT,
  },
  readOnlyIntrospections: EXPECTED_TOOL_NAMES.map((toolName) => ({
    toolName,
    registeredCommandKeys: expectedCommandKeys,
    expectedCommandKeys,
  })),
});

interface ToolsListToolShape {
  readonly name: string;
}

interface ToolsListResult {
  readonly tools: readonly ToolsListToolShape[];
}

// `mcp-testing`'s own `checkReadOnlyIsolation` has NEVER had a real caller
// before this package: `eds`/`aco` both pass no `readOnlyIntrospections`
// (design.md, Decision 9 — "this package supplies both: the probe against a
// genuine execFile-based read-only tool, and readOnlyIntrospections against
// the allowlist's real output"). The wiring above only ever exercises the
// NO-VIOLATION path (registered === expected); this positive control proves
// the shared function genuinely detects contamination in THIS package's own
// real allowlist output, not merely that it compiles and returns `[]`.
describe("checkReadOnlyIsolation (mcp-testing) — positive control against magento-cloud's real allowlist", () => {
  it("returns exactly one violation when the real registered keys are contaminated with a forbidden command", () => {
    const contaminated = [...expectedCommandKeys, `${FAKE_BIN_DIR}/magento-cloud db:dump`];

    const violations = checkReadOnlyIsolation({
      toolName: "magentocloud_query_database",
      registeredCommandKeys: contaminated,
      expectedCommandKeys,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.disallowedCommand).toBe(`${FAKE_BIN_DIR}/magento-cloud db:dump`);
  });

  it("returns no violations against the real, uncontaminated registered keys (contrast case)", () => {
    const violations = checkReadOnlyIsolation({
      toolName: "magentocloud_query_database",
      registeredCommandKeys: expectedCommandKeys,
      expectedCommandKeys,
    });

    expect(violations).toEqual([]);
  });
});

describe(`magento-cloud tool surface on the built bundle: ${serverPath}`, () => {
  it("declares exactly the eight magentocloud_* tools (tasks.md 9.5)", async () => {
    const client = new JsonRpcClient({ command: process.execPath, args: [serverPath] });
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "magento-cloud-tool-surface", version: "0.0.0" },
      });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/list")) as ToolsListResult;

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
      expect(result.tools).toHaveLength(8);
    } finally {
      client.close();
    }
  });
});
