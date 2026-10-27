// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 4.16; eds-mcp spec, "Fourteen-Tool
// Surface With a Single Write Entry Point", "eds_apply Requires User
// Interaction in Clients That Support It"): what a client actually receives
// from `tools/list` on the BUILT bundle. The unit tests prove what
// `createEdsTools` returns; this proves `mcp.ts` registers it — including
// `_meta`, which the SDK only emits if the registration passes it on.
// Runs after `build` (turbo `test` dependsOn `build`), like the conformance
// suite next to it.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRpcClient } from "@hiberus-magento/mcp-testing";

const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

interface ListedTool {
  readonly name: string;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

describe("tools/list on the built server", () => {
  let client: JsonRpcClient;
  let tools: readonly ListedTool[];

  beforeAll(async () => {
    client = new JsonRpcClient({ command: process.execPath, args: [serverPath] });
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "eds-tools-list-test", version: "0.0.0" } });
    client.notify("notifications/initialized");
    tools = ((await client.request("tools/list")) as { tools: ListedTool[] }).tools;
  });

  afterAll(() => {
    client.close();
  });

  it("lists exactly the fourteen tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "eds_apply",
        "eds_get_audit_log",
        "eds_get_code_status",
        "eds_get_config_versions",
        "eds_get_job_status",
        "eds_get_robots",
        "eds_get_site_config",
        "eds_get_snapshots",
        "eds_get_status",
        "eds_get_status_bulk",
        "eds_list_api_keys",
        "eds_list_jobs",
        "eds_list_sites",
        "eds_plan",
      ].sort(),
    );
  });

  it("eds_apply carries _meta['anthropic/requiresUserInteraction'] === true; no other tool has the key", () => {
    for (const t of tools) {
      const value = t._meta?.["anthropic/requiresUserInteraction"];
      if (t.name === "eds_apply") expect(value).toBe(true);
      else expect(value, t.name).toBeUndefined();
    }
  });

  it("eds_apply is the only tool not marked read-only", () => {
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual(["eds_apply"]);
  });
});
