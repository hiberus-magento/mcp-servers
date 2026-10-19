// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite (mcp-conformance spec) against the
// BUILT `hiberus-aco-mcp` bundle, with NO `shellOutProbe` supplied (tasks.md
// 6.2) — `aco` is a pure-HTTPS domain with no `execFile`-based tool, exactly
// the case the domain-independent fd-1 probe was added for in change 2
// (mcp-conformance spec, "Stdout Purity Assertion": "Domain-independent
// probe catches contamination with no shellOutProbe supplied"). Wired as an
// ordinary `turbo test` step with `dependsOn: ["build", "^build"]`, so the
// bundle always exists before this file runs.
//
// Two assertions ride on top of the shared suite, at the artifact layer —
// the layer where "what ships is what was designed" is actually provable
// (design.md, Decision 3's three-layer proof table):
//
//   - tasks.md 6.1: `tools/list` on the built bundle returns exactly the six
//     declared tool names (deep-equal, sorted) — the artifact-layer proof of
//     5.1 (unit) and this file (built bundle).
//   - tasks.md 6.3: `aco_toggle_policy_filter`'s `mode` field carries NO `"all"`
//     branch in the JSON Schema the built server actually serves — the
//     third of the three independent no-`"all"`-branch proofs.
//
//     DEVIATION FROM tasks.md, recorded here rather than silently fixed:
//     tasks.md 6.3 states the assertion as `properties.mode.enum` deep-equal
//     to `["named"]`. Verified against this repo's actual dependency chain
//     (@modelcontextprotocol/sdk@1.30.0 -> zod/v4-mini's `toJSONSchema`,
//     target "draft-7"): a `z.literal("named")` field compiles to
//     `{ "type": "string", "const": "named" }`, never `{ "enum": [...] }`.
//     `enum` is zod v4's rendering for a *union* of literals; a single
//     literal renders as `const`. The assertion below checks `const`, which
//     is the value actually present on the wire, and is the equally-strong
//     proof tasks.md intended: no `"all"` branch is reachable either way.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRpcClient, describeConformance } from "@hiberus-magento/mcp-testing";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

// Intentionally no `shellOutProbe`: proves the packaging + fd-1 gates pass
// for a package that ships no decorative exec tool, exactly like `eds`.
describeConformance({
  serverPath,
  packageDir,
});

const EXPECTED_TOOL_NAMES = [
  "aco_get_facet_values",
  "aco_list_catalog_views",
  "aco_list_policies",
  "aco_list_price_books",
  "aco_search_catalog",
  "aco_toggle_policy_filter",
] as const;

interface ToolsListToolShape {
  readonly name: string;
  readonly inputSchema?: {
    readonly properties?: Record<string, { readonly const?: unknown; readonly enum?: readonly unknown[] }>;
  };
}

interface ToolsListResult {
  readonly tools: readonly ToolsListToolShape[];
}

describe(`aco tool surface on the built bundle: ${serverPath}`, () => {
  let client: JsonRpcClient;
  let tools: readonly ToolsListToolShape[];

  beforeAll(async () => {
    client = new JsonRpcClient({ command: process.execPath, args: [serverPath] });
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "aco-mcp-tool-surface", version: "0.0.0" },
    });
    client.notify("notifications/initialized");
    const result = (await client.request("tools/list")) as ToolsListResult;
    tools = result.tools;
  });

  afterAll(() => {
    client.close();
  });

  it("declares exactly the six aco_* tools (tasks.md 6.1)", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    expect(tools).toHaveLength(6);
  });

  it("aco_toggle_policy_filter's mode field carries no \"all\" branch on the built bundle (tasks.md 6.3)", () => {
    const toggle = tools.find((tool) => tool.name === "aco_toggle_policy_filter");
    expect(toggle, "aco_toggle_policy_filter was not found in tools/list").toBeDefined();
    const modeSchema = toggle?.inputSchema?.properties?.["mode"];
    expect(modeSchema, "aco_toggle_policy_filter's inputSchema has no \"mode\" property").toBeDefined();
    // The built JSON Schema renders a single zod literal as `const`, never
    // `enum` — see the file-header deviation note.
    expect(modeSchema?.const).toBe("named");
    expect(modeSchema?.enum).toBeUndefined();
  });
});
