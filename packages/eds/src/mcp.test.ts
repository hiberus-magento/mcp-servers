// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 7): the nine-tool surface, its two hazard
// gates, its annotations, and the missing-credential failure path — all
// unit-testable without spawning a process, since `createEdsTools` (in
// `./tools/eds-tools.ts`, see that file's header for why it is separate
// from `mcp.ts`) is a pure function of an already-constructed `EdsClient`.
// The stdio-guard installation is checked by a source scan of `mcp.ts`
// itself, which — unlike the tool factory — DOES connect unconditionally at
// import time and is therefore never imported by this test file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "./testing/fetch-double.js";
import { createEdsClient } from "./client/index.js";
import { createEdsTools, edsReindexInput, nonEmptyPaths } from "./tools/eds-tools.js";
import { createEdsTokenProvider } from "./credential-provider.js";

function makeClient(routes: Record<string, unknown> = {}) {
  const { fetch } = createFetchDouble(routes as never);
  return createEdsClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: "k" }),
      invalidate: () => undefined,
      describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
    },
    baseUrl: "https://admin.hlx.page",
    org: "acme-demo-org",
  });
}

const EXPECTED_TOOL_NAMES = [
  "eds_get_status",
  "eds_get_status_bulk",
  "eds_set_live_state",
  "eds_get_site_config",
  "eds_reindex",
  "eds_get_audit_log",
  "eds_get_snapshots",
  "eds_manage_snapshot",
  "eds_get_job_status",
] as const;

describe("createEdsTools — tools/list surface (tasks.md 7.10)", () => {
  it("returns exactly the nine named tools and no others", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    expect(tools).toHaveLength(9);
  });
});

describe("createEdsTools — annotations (tasks.md 7.12)", () => {
  const expected: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }> = {
    eds_get_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    eds_get_status_bulk: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    eds_set_live_state: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    eds_get_site_config: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    eds_reindex: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    eds_get_audit_log: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    eds_get_snapshots: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    eds_manage_snapshot: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    eds_get_job_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };

  it("matches the documented readOnly/destructive/idempotent triple for every tool", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    for (const tool of tools) {
      const want = expected[tool.name];
      if (want === undefined) {
        throw new Error(`no expected annotation entry for "${tool.name}"`);
      }
      expect(tool.annotations.readOnlyHint, `${tool.name}.readOnlyHint`).toBe(want.readOnlyHint);
      expect(tool.annotations.destructiveHint, `${tool.name}.destructiveHint`).toBe(want.destructiveHint);
      expect(tool.annotations.idempotentHint, `${tool.name}.idempotentHint`).toBe(want.idempotentHint);
    }
  });

  it("every description opens with 'Use this' (states WHEN to use it, not only what it does)", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    for (const tool of tools) {
      expect(tool.description.startsWith("Use this"), `${tool.name}'s description: "${tool.description}"`).toBe(true);
    }
  });
});

describe("edsReindexInput — the full-site hazard gate (tasks.md 7.3)", () => {
  it("rejects scope: full-site with confirmFullReindex omitted", () => {
    const result = edsReindexInput.safeParse({ site: "acme-demo-site-eu", request: { scope: "full-site" } });
    expect(result.success).toBe(false);
  });

  it("rejects scope: full-site with confirmFullReindex: false", () => {
    const result = edsReindexInput.safeParse({
      site: "acme-demo-site-eu",
      request: { scope: "full-site", confirmFullReindex: false },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a stray field on the paths branch", () => {
    const result = edsReindexInput.safeParse({
      site: "acme-demo-site-eu",
      request: { scope: "paths", paths: ["/a"], confirmFullReindex: true },
    });
    expect(result.success).toBe(false);
  });

  it("accepts scope: full-site with confirmFullReindex: true", () => {
    const result = edsReindexInput.safeParse({
      site: "acme-demo-site-eu",
      request: { scope: "full-site", confirmFullReindex: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts scope: paths with a non-empty paths array", () => {
    const result = edsReindexInput.safeParse({ site: "acme-demo-site-eu", request: { scope: "paths", paths: ["/a"] } });
    expect(result.success).toBe(true);
  });
});

describe("nonEmptyPaths — the bulk-write hazard gate (tasks.md 7.5)", () => {
  it("rejects an omitted paths field for eds_get_status_bulk", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    const tool = tools.find((t) => t.name === "eds_get_status_bulk");
    const result = tool?.inputSchema.safeParse({ site: "acme-demo-site-eu" });
    expect(result?.success).toBe(false);
  });

  it("rejects an empty paths array for eds_get_status_bulk", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    const tool = tools.find((t) => t.name === "eds_get_status_bulk");
    const result = tool?.inputSchema.safeParse({ site: "acme-demo-site-eu", paths: [] });
    expect(result?.success).toBe(false);
  });

  it("rejects an omitted paths field for eds_set_live_state", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    const tool = tools.find((t) => t.name === "eds_set_live_state");
    const result = tool?.inputSchema.safeParse({ site: "acme-demo-site-eu", state: "published" });
    expect(result?.success).toBe(false);
  });

  it("rejects an empty paths array for eds_set_live_state", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    const tool = tools.find((t) => t.name === "eds_set_live_state");
    const result = tool?.inputSchema.safeParse({ site: "acme-demo-site-eu", state: "published", paths: [] });
    expect(result?.success).toBe(false);
  });

  it("rejects an empty paths array on eds_reindex's paths branch", () => {
    const result = edsReindexInput.safeParse({ site: "acme-demo-site-eu", request: { scope: "paths", paths: [] } });
    expect(result.success).toBe(false);
  });

  it("nonEmptyPaths itself rejects [] and accepts a non-empty array", () => {
    expect(nonEmptyPaths.safeParse([]).success).toBe(false);
    expect(nonEmptyPaths.safeParse(["/a"]).success).toBe(true);
  });
});

describe("CLI-only operations are absent from the MCP surface (tasks.md 8.3/8.4, eds-cli spec)", () => {
  // eds-cli spec, "CLI-Only Operations Excluded from MCP": none of these
  // twelve operations may have a corresponding MCP tool. "auth mint" is a
  // CLI subcommand name, not a tool name — it is checked by substring
  // absence below rather than as an exact tool-name match.
  const CLI_ONLY_OPERATIONS = [
    "site apply",
    "site delete",
    "site source set",
    "key create",
    "key delete",
    "auth mint",
    "code show",
    "code sync",
    "code delete",
    "version restore",
    "cache purge",
    "robots show",
    "sitemap rebuild",
  ];

  it("no eds_* tool corresponds to any CLI-only operation", () => {
    const tools = createEdsTools({ getRuntime: () => ({ client: makeClient(), org: "acme-demo-org" }) });
    const toolNames = tools.map((t) => t.name);
    for (const operation of CLI_ONLY_OPERATIONS) {
      const slug = operation.replace(/\s+/g, "_");
      expect(toolNames.some((name) => name.includes(slug)), `unexpected tool for CLI-only operation "${operation}"`).toBe(false);
    }
    expect(toolNames).toHaveLength(9);
  });
});

describe("missing credential — immediate actionable failure, never a hang (tasks.md 7.14)", () => {
  it("returns isError: true naming 'hiberus-eds auth token set', without hanging", async () => {
    const emptyConfigDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
    delete process.env.EDS_TOKEN;
    const client = createEdsClient({
      fetch: (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: createEdsTokenProvider({ configDir: emptyConfigDir }),
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });
    const tools = createEdsTools({ getRuntime: () => ({ client, org: "acme-demo-org" }) });
    const tool = tools.find((t) => t.name === "eds_get_status");
    if (tool === undefined) {
      throw new Error("eds_get_status not found");
    }

    const result = await tool.invoke({ site: "acme-demo-site-eu", path: "/" }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("hiberus-eds auth token set");
  });
});

describe("mcp.ts installs the stdout guard (tasks.md 7.16)", () => {
  it("passes process.stdin and createStdioServer()'s private stdout into StdioServerTransport", () => {
    const source = readFileSync(fileURLToPath(new URL("./mcp.ts", import.meta.url)), "utf8");
    expect(source).toContain("const { stdout } = createStdioServer();");
    expect(source).toContain("new StdioServerTransport(process.stdin, stdout)");
  });
});
