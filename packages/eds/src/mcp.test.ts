// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 7; eds-write-surface tasks.md 4.15, 4.16): the
// fourteen-tool surface, its annotations, the one write entry point, and the
// missing-credential failure path — all unit-testable without spawning a
// process, since `createEdsTools` (in `./tools/eds-tools.ts`, see that file's
// header for why it is separate from `mcp.ts`) is a pure function of an
// already-constructed `EdsClient`. The stdio-guard installation is checked by
// a source scan of `mcp.ts` itself, which — unlike the tool factory — DOES
// connect unconditionally at import time and is therefore never imported by
// this test file. `tools/list` over the wire is `mcp.tools-list.test.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, type RouteTable } from "./testing/fetch-double.js";
import { callKeys, createClientDouble, TEST_ORG } from "./testing/client-double.js";
import { createEdsClient, type EdsClient } from "./client/index.js";
import { createEdsTools, nonEmptyPaths, REQUIRES_USER_INTERACTION_META, type EdsMcpTool } from "./tools/eds-tools.js";
import { createEdsTokenProvider } from "./credential-provider.js";

const EU = "acme-demo-site-eu";
const EU_DOC = `/config/${TEST_ORG}/sites/${EU}.json`;

function makeClient(routes: Record<string, unknown> = {}): EdsClient {
  return createClientDouble(routes as RouteTable).client;
}

function toolsOver(client: EdsClient, extra: { protectedSites?: readonly string[] } = {}): readonly EdsMcpTool[] {
  return createEdsTools({ getRuntime: () => ({ client, org: TEST_ORG }), ...extra });
}

function tool(tools: readonly EdsMcpTool[], name: string): EdsMcpTool {
  const found = tools.find((t) => t.name === name);
  if (found === undefined) throw new Error(`${name} not found`);
  return found;
}

async function call(tools: readonly EdsMcpTool[], name: string, args: unknown): Promise<unknown> {
  const result = await tool(tools, name).invoke(args, {});
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "null");
}

const READ_TRIPLE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const EXPECTED_ANNOTATIONS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }> = {
  eds_get_status: READ_TRIPLE,
  eds_get_status_bulk: READ_TRIPLE,
  eds_get_site_config: READ_TRIPLE,
  eds_get_audit_log: READ_TRIPLE,
  eds_get_snapshots: READ_TRIPLE,
  eds_get_job_status: READ_TRIPLE,
  eds_list_sites: READ_TRIPLE,
  eds_get_config_versions: READ_TRIPLE,
  eds_get_robots: READ_TRIPLE,
  eds_get_code_status: READ_TRIPLE,
  eds_list_jobs: READ_TRIPLE,
  eds_list_api_keys: READ_TRIPLE,
  eds_plan: READ_TRIPLE,
  eds_apply: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};

describe("createEdsTools — tools/list surface (4.16)", () => {
  it("returns exactly the fourteen named tools and no others", () => {
    const names = toolsOver(makeClient()).map((t) => t.name);
    expect([...names].sort()).toEqual(Object.keys(EXPECTED_ANNOTATIONS).sort());
    expect(names).toHaveLength(14);
  });

  it.each(["eds_set_live_state", "eds_reindex", "eds_manage_snapshot"])("%s is removed", (name) => {
    expect(toolsOver(makeClient()).some((t) => t.name === name)).toBe(false);
  });

  it("no tool creates or deletes an API key, or mints a token", () => {
    const names = toolsOver(makeClient()).map((t) => t.name);
    for (const fragment of ["key_create", "create_key", "key_delete", "delete_key", "mint"]) {
      expect(names.some((name) => name.includes(fragment)), fragment).toBe(false);
    }
  });
});

describe("createEdsTools — annotations (4.16)", () => {
  it("matches the documented readOnly/destructive/idempotent triple for every tool", () => {
    for (const t of toolsOver(makeClient())) {
      const want = EXPECTED_ANNOTATIONS[t.name];
      if (want === undefined) throw new Error(`no expected annotation entry for "${t.name}"`);
      expect(t.annotations.readOnlyHint, `${t.name}.readOnlyHint`).toBe(want.readOnlyHint);
      expect(t.annotations.destructiveHint, `${t.name}.destructiveHint`).toBe(want.destructiveHint);
      expect(t.annotations.idempotentHint, `${t.name}.idempotentHint`).toBe(want.idempotentHint);
    }
  });

  it("every description opens with 'Use this' (states WHEN to use it, not only what it does)", () => {
    for (const t of toolsOver(makeClient())) {
      expect(t.description.startsWith("Use this"), `${t.name}'s description: "${t.description}"`).toBe(true);
    }
  });

  it("only eds_apply carries requiresUserInteraction, as the JSON Boolean true (D3)", () => {
    expect(REQUIRES_USER_INTERACTION_META).toEqual({ "anthropic/requiresUserInteraction": true });
    for (const t of toolsOver(makeClient())) {
      if (t.name === "eds_apply") {
        expect(t.meta).toEqual({ "anthropic/requiresUserInteraction": true });
      } else {
        expect(t.meta?.["anthropic/requiresUserInteraction"], t.name).toBeUndefined();
      }
    }
  });
});

describe("eds_apply is the only tool that writes (4.8 source half; eds-mcp spec, 'Read tools never write')", () => {
  const toolsDir = fileURLToPath(new URL("./tools/", import.meta.url));
  const sources = readdirSync(toolsDir)
    .filter((file) => file.endsWith(".ts") && !file.includes(".test"))
    .map((file) => ({ file, text: readFileSync(`${toolsDir}${file}`, "utf8") }));

  it("only apply.ts calls sendPlannedRequest", () => {
    expect(sources.filter((s) => s.text.includes("sendPlannedRequest(")).map((s) => s.file)).toEqual(["apply.ts"]);
  });

  it("no tool module reaches past the client's operations into its raw http", () => {
    expect(sources.filter((s) => /\.http\b/.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it("no tool module calls a typed client write", () => {
    const WRITES = [
      "createSite(",
      "updateSiteConfig(",
      "deleteSite(",
      "restoreConfigVersion(",
      "setRobots(",
      "previewPath(",
      "unpreviewPath(",
      "previewBulk(",
      "setLiveState(",
      "publishPath(",
      "unpublishPath(",
      "reindex(",
      "indexPath(",
      "unindexPath(",
      "purgeCache(",
      "rebuildSitemap(",
      "syncCode(",
      "deleteCode(",
      "stopJob(",
      "mintApiKey(",
      "deleteApiKey(",
      "addToSnapshot(",
      "removeFromSnapshot(",
      "publishSnapshot(",
      "reviewSnapshot(",
      "deleteSnapshot(",
    ];
    for (const { file, text } of sources) {
      for (const write of WRITES) expect(text.includes(write), `${file} calls ${write}`).toBe(false);
    }
  });

  it("every read tool, called with valid input, issues no write", async () => {
    const reads = {
      [`GET /status/${TEST_ORG}/${EU}/main/a`]: { status: 200, body: {} },
      [`POST /status/${TEST_ORG}/${EU}/main/*`]: {
        status: 200,
        body: { job: { name: "j", topic: "status", state: "stopped", data: { phase: "completed", resources: [] } }, links: { self: "https://admin.hlx.page/job/x" } },
      },
      [`GET ${EU_DOC}`]: { status: 200, body: { code: { owner: "example-owner", repo: "example-repo" } } },
      [`GET /config/${TEST_ORG}/sites/${EU}/cdn.json`]: { status: 404 },
      [`GET /status/${TEST_ORG}/${EU}/main/`]: { status: 200, body: {} },
      [`GET /log/${TEST_ORG}/${EU}/main`]: { status: 200, body: { entries: [] } },
      [`GET /snapshot/${TEST_ORG}/${EU}/main`]: { status: 200, body: { snapshots: [] } },
      [`GET /job/${TEST_ORG}/${EU}/main/live/job-demo`]: { status: 200, body: { job: { name: "job-demo", topic: "live", state: "completed" }, links: { self: "https://admin.hlx.page/job/x" } } },
      [`GET /config/${TEST_ORG}/sites.json`]: { status: 200, body: { sites: [{ name: EU }] } },
      [`GET /config/${TEST_ORG}/sites/${EU}/versions.json`]: { status: 200, body: { current: 1, versions: [] } },
      [`GET /config/${TEST_ORG}/sites/${EU}/robots.txt`]: { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *" },
      [`GET /code/example-owner/example-repo/main/scripts/a.js`]: { status: 200, body: { code: { status: 200 } } },
      [`GET /job/${TEST_ORG}/${EU}/main/live`]: { status: 200, body: { topic: "live", jobs: [], links: { self: "x" } } },
      [`GET /config/${TEST_ORG}/apiKeys.json`]: { status: 200, body: {} },
    };
    const { client, calls } = createClientDouble(new Proxy(reads, { get: (target, key: string) => (target as Record<string, unknown>)[key] ?? { status: 200, body: {} } }) as RouteTable);
    const tools = toolsOver(client);
    const inputs: Record<string, unknown> = {
      eds_get_status: { site: EU, path: "/a" },
      eds_get_status_bulk: { site: EU, paths: ["/a"] },
      eds_get_site_config: { site: EU },
      eds_get_audit_log: { site: EU },
      eds_get_snapshots: { site: EU },
      eds_get_job_status: { site: EU, topic: "live", name: "job-demo" },
      eds_list_sites: {},
      eds_get_config_versions: { site: EU },
      eds_get_robots: { site: EU },
      eds_get_code_status: { site: EU, path: "/scripts/a.js" },
      eds_list_jobs: { site: EU, topic: "live" },
      eds_list_api_keys: {},
      eds_plan: { site: EU, operation: { kind: "live.publish", paths: ["/a"] } },
    };

    for (const [name, args] of Object.entries(inputs)) await tool(tools, name).invoke(args, {});

    const BULK_STATUS = `POST /status/${TEST_ORG}/${EU}/main/*`;
    expect(callKeys(calls).filter((key) => !key.startsWith("GET ") && key !== BULK_STATUS)).toEqual([]);
  });
});

describe("new read tools (4.15)", () => {
  it("eds_list_sites lists the org's site names", async () => {
    const tools = toolsOver(makeClient({ [`GET /config/${TEST_ORG}/sites.json`]: { status: 200, body: { sites: [{ name: EU }, { name: "acme-demo-site-us" }] } } }));
    expect(await call(tools, "eds_list_sites", {})).toEqual({ sites: [EU, "acme-demo-site-us"] });
  });

  it("eds_get_config_versions returns the versions list", async () => {
    const versions = { current: 3, versions: [{ version: 3, created: "2026-10-01T00:00:00Z", name: "demo" }] };
    const tools = toolsOver(makeClient({ [`GET /config/${TEST_ORG}/sites/${EU}/versions.json`]: { status: 200, body: versions } }));
    expect(await call(tools, "eds_get_config_versions", { site: EU })).toEqual(versions);
  });

  it("eds_get_robots returns the text unparsed", async () => {
    const tools = toolsOver(
      makeClient({ [`GET /config/${TEST_ORG}/sites/${EU}/robots.txt`]: { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /" } }),
    );
    expect(await call(tools, "eds_get_robots", { site: EU })).toEqual({ site: EU, content: "User-agent: *\nDisallow: /" });
  });

  it("eds_get_code_status resolves the repository from the site, and takes no owner/repo", async () => {
    const tools = toolsOver(
      makeClient({
        [`GET ${EU_DOC}`]: { status: 200, body: { code: { owner: "example-owner", repo: "example-repo" } } },
        [`GET /code/example-owner/example-repo/main/scripts/a.js`]: { status: 200, body: { code: { status: 200 } } },
      }),
    );
    expect(await call(tools, "eds_get_code_status", { site: EU, path: "/scripts/a.js" })).toEqual({
      repository: "example-owner/example-repo",
      status: { code: { status: 200 } },
    });
    expect(tool(tools, "eds_get_code_status").inputSchema.safeParse({ site: EU, path: "/a.js", owner: "other-owner" }).success).toBe(false);
  });

  it("eds_list_jobs lists a topic's jobs", async () => {
    const list = { topic: "live", jobs: [{ name: "job-demo", state: "completed", time: "2026-10-01T00:00:00Z", href: "x" }], links: { self: "x" } };
    const tools = toolsOver(makeClient({ [`GET /job/${TEST_ORG}/${EU}/main/live`]: { status: 200, body: list } }));
    expect(await call(tools, "eds_list_jobs", { site: EU, topic: "live" })).toEqual(list);
  });

  it("eds_list_api_keys is org-level, rejects a site field, and returns metadata only", async () => {
    const tools = toolsOver(
      makeClient({
        [`GET /config/${TEST_ORG}/apiKeys.json`]: {
          status: 200,
          body: { "opaque-key-id-demo": { id: "key-demo-1", roles: ["publish"], description: "demo", value: "secret-material-demo" } },
        },
      }),
    );
    expect(tool(tools, "eds_list_api_keys").inputSchema.safeParse({ site: EU }).success).toBe(false);
    const keys = await call(tools, "eds_list_api_keys", {});
    expect(keys).toEqual([{ id: "key-demo-1", roles: ["publish"], description: "demo" }]);
    expect(JSON.stringify(keys)).not.toContain("secret-material-demo");
    expect(JSON.stringify(keys)).not.toContain("opaque-key-id-demo");
  });
});

describe("eds_plan → eds_apply through the tools", () => {
  const DOC = { code: { owner: "example-owner", repo: "example-repo" }, a: 1 };

  it("plans, then applies exactly the plan", async () => {
    const { client, calls } = createClientDouble({
      [`GET ${EU_DOC}`]: { status: 200, body: DOC },
      [`GET /config/${TEST_ORG}/sites/${EU}/versions.json`]: { status: 200, body: { current: 4, versions: [] } },
      [`POST ${EU_DOC}`]: { status: 200, body: { ...DOC, a: 2 } },
    });
    const tools = toolsOver(client);

    const planned = (await call(tools, "eds_plan", { site: EU, operation: { kind: "config.patch", patch: { a: 2 } } })) as { token: string };
    const applied = await call(tools, "eds_apply", { token: planned.token });

    expect(applied).toMatchObject({ status: "applied", site: EU, kind: "config.patch", previousVersionId: "4" });
    expect(callKeys(calls).filter((key) => key.startsWith("POST "))).toEqual([`POST ${EU_DOC}`]);
  });

  it("protectedSites from the config reaches the plan and the apply", async () => {
    const { client } = createClientDouble({
      [`GET ${EU_DOC}`]: { status: 200, body: DOC },
      [`POST /live/${TEST_ORG}/${EU}/main/a`]: { status: 200, body: {} },
    });
    const tools = toolsOver(client, { protectedSites: ["*-eu"] });

    const planned = (await call(tools, "eds_plan", { site: EU, operation: { kind: "live.publish", paths: ["/a"] } })) as { token: string; requiresConfirmSite: boolean };
    expect(planned.requiresConfirmSite).toBe(true);
    expect(await call(tools, "eds_apply", { token: planned.token })).toMatchObject({ status: "rejected", reason: "confirm-site-missing" });
    expect(await call(tools, "eds_apply", { token: planned.token, confirmSite: EU })).toMatchObject({ status: "applied" });
  });

  it("eds_apply rejects extra operation fields at the schema level (4.12)", async () => {
    const tools = toolsOver(makeClient());
    await expect(tool(tools, "eds_apply").invoke({ token: "t", site: "acme-demo-site-us" }, {})).rejects.toThrow();
  });

  // The operator-facing half of the empty-body defect, carried over from
  // `eds_manage_snapshot`: the snapshot really was deleted, and the old tool
  // still answered `Unexpected end of JSON input`. Retrying a destructive
  // operation on that basis acts on a false belief about the site.
  it("a 204 with no body applies as done-with-no-content, never as a JSON parse failure", async () => {
    const SNAPSHOT = `/snapshot/${TEST_ORG}/${EU}/main/launch-2026`;
    const { client } = createClientDouble({ [`DELETE ${SNAPSHOT}`]: { status: 204, headers: { "content-type": "text/plain; charset=utf-8" } } });
    const tools = toolsOver(client);

    const planned = (await call(tools, "eds_plan", { site: EU, operation: { kind: "snapshot.delete", id: "launch-2026" } })) as { token: string };
    const result = await tool(tools, "eds_apply").invoke({ token: planned.token }, {});

    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).not.toContain("JSON input");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ status: "applied", responses: [null] });
  });
});

describe("nonEmptyPaths — the bulk-status hazard gate (tasks.md 7.5)", () => {
  it("rejects an omitted or empty paths field for eds_get_status_bulk", () => {
    const bulk = tool(toolsOver(makeClient()), "eds_get_status_bulk");
    expect(bulk.inputSchema.safeParse({ site: EU }).success).toBe(false);
    expect(bulk.inputSchema.safeParse({ site: EU, paths: [] }).success).toBe(false);
  });

  it("nonEmptyPaths itself rejects [] and accepts a non-empty array", () => {
    expect(nonEmptyPaths.safeParse([]).success).toBe(false);
    expect(nonEmptyPaths.safeParse(["/a"]).success).toBe(true);
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
      org: TEST_ORG,
    });

    const result = await tool(toolsOver(client), "eds_get_status").invoke({ site: EU, path: "/" }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("hiberus-eds auth token set");
  });
});

describe("mcp.ts installs the stdout guard (tasks.md 7.16)", () => {
  const source = readFileSync(fileURLToPath(new URL("./mcp.ts", import.meta.url)), "utf8");

  it("passes process.stdin and createStdioServer()'s private stdout into StdioServerTransport", () => {
    expect(source).toContain("const { stdout } = createStdioServer();");
    expect(source).toContain("new StdioServerTransport(process.stdin, stdout)");
  });

  it("reads EDS_PROTECTED_SITES and passes it to the tools (4.11)", () => {
    expect(source).toContain("parseProtectedSites(process.env.EDS_PROTECTED_SITES)");
  });
});

// RED-first: `eds_get_status_bulk` submitted the query and then polled a
// job the Admin API had already finished and discarded — observed live,
// that poll answers 404. The results are inline in the POST response.
describe("eds_get_status_bulk reads the finished job's results inline (observed live)", () => {
  const BULK_POST_PATH = `/status/${TEST_ORG}/${EU}/main/*`;
  const COMPLETED_BULK_BODY = {
    job: {
      topic: "status",
      user: "demo-author@example-domain",
      name: "job-2026-10-20t00-00-00-000z",
      state: "stopped",
      invocationId: "00000000-0000-4000-8000-000000000000",
      data: {
        paths: [{ path: "/" }, { path: "/drafts/test" }],
        pathsOnly: false,
        select: ["preview", "live"],
        phase: "completed",
        resources: [{ path: "/", previewLastModified: "Mon, 19 Oct 2026 10:00:00 GMT" }],
      },
    },
    links: { self: `https://admin.hlx.page/job/${TEST_ORG}/${EU}/main/status/job-2026-10-20t00-00-00-000z` },
  };

  it("returns the per-path results and the absent path, issuing no job GET at all", async () => {
    // Only the POST is routed: the fetch double throws on any other call,
    // so a follow-up poll fails this test rather than passing silently.
    const { fetch, calls } = createFetchDouble({ [`POST ${BULK_POST_PATH}`]: { status: 200, body: COMPLETED_BULK_BODY } } as never);
    const client = createEdsClient({
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
      org: TEST_ORG,
    });

    const payload = (await call(toolsOver(client), "eds_get_status_bulk", { site: EU, paths: ["/", "/drafts/test"] })) as {
      results?: { path: string }[];
      missingPaths?: string[];
    };

    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(payload.results?.map((entry) => entry.path)).toEqual(["/"]);
    expect(payload.missingPaths).toEqual(["/drafts/test"]);
  });
});
