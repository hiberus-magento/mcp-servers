// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 5). Covers: exactly six tools, asserted by
// count AND name (unit — the runtime proof; the built-bundle conformance
// proof is Phase 6, out of scope here); the CLI-only exclusion list has no
// corresponding tool name; `aco_toggle_policy`'s runtime rejection of
// `mode: "all"` / empty / omitted `names` / unknown keys (the SECOND of
// three independent no-"all"-branch proofs — the first is `mcp.test-d.ts`,
// the third is Phase 6's built-bundle JSON Schema check); the no-op-at-
// already-held-state requirement; the two-tier credential boundary (Tier A
// always succeeds, Tier B fails actionably with no credential); the
// facet-values tool-layer sampling-fallback boundary (mirrors client-layer
// 2.8, proven independently here); Merchandising tools sending no
// authorization-shaped header; description content; and annotations.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistCredential } from "@hiberus-magento/mcp-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAcoClient, type AcoClient } from "../client/index.js";
import { createAdminTokenProvider } from "../credential-provider.js";
import { createFetchDouble, graphQlErrors, graphQlOk } from "../testing/fetch-double.js";
import { CLI_ONLY_OPERATIONS } from "../cli.js";
import { acoTogglePolicyInput, createAcoTools, nonEmptyPolicyNames } from "./aco-tools.js";

const TIER_A_TOOLS = ["aco_search_catalog", "aco_get_facet_values"] as const;
const TIER_B_TOOLS = ["aco_list_catalog_views", "aco_list_price_books", "aco_list_policies", "aco_toggle_policy"] as const;
const ALL_SIX = [...TIER_A_TOOLS, ...TIER_B_TOOLS] as const;

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A JWT-shaped, unexpired, unsigned Bearer — enough for `PastedBearerProvider`'s expiry check to pass so an admin call actually reaches the fetch double. */
function persistValidBearer(configDir: string): void {
  const token = `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify({ created_at: Date.now() - 1_000, expires_in: 60_000 }))}.unsigned`;
  persistCredential("aco", token, configDir);
}

function buildClient(routes: Record<string, unknown>, configDir: string): { client: AcoClient; calls: readonly { readonly operationName: string | undefined; readonly headers: Readonly<Record<string, string>> }[] } {
  const { fetch, calls } = createFetchDouble(routes as never);
  const client = createAcoClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    adminBaseUrl: "https://admin.aco.example/admin/graphql",
    merchandisingBaseUrl: "https://merch.aco.example/graphql",
    tokenProvider: createAdminTokenProvider({ now: () => Date.now(), fetch, configDir }),
  });
  return { client, calls };
}

describe("createAcoTools — exactly six tools", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-count-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("registers exactly the six declared names, and no more", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_SIX].sort());
  });

  it("has no tool name corresponding to any CLI-only operation", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const toolNames = tools.map((t) => t.name);

    for (const op of CLI_ONLY_OPERATIONS) {
      expect(toolNames).not.toContain(op);
    }
  });
});

describe("aco_toggle_policy — the type is exactly `mode: \"named\"`, no all branch (runtime proof #2 of 3)", () => {
  it("safeParse rejects mode: \"all\"", () => {
    const result = acoTogglePolicyInput.safeParse({ mode: "all", names: ["outdoor-gear-discount"], enabled: true });
    expect(result.success).toBe(false);
  });

  it("safeParse rejects an empty names array", () => {
    const result = acoTogglePolicyInput.safeParse({ mode: "named", names: [], enabled: true });
    expect(result.success).toBe(false);
  });

  it("safeParse rejects an omitted names field", () => {
    const result = acoTogglePolicyInput.safeParse({ mode: "named", enabled: true });
    expect(result.success).toBe(false);
  });

  it("safeParse rejects an unknown key (.strict())", () => {
    const result = acoTogglePolicyInput.safeParse({ mode: "named", names: ["x"], enabled: true, extra: "nope" });
    expect(result.success).toBe(false);
  });

  it("safeParse accepts the valid shape", () => {
    const result = acoTogglePolicyInput.safeParse({ mode: "named", names: ["outdoor-gear-discount"], enabled: true });
    expect(result.success).toBe(true);
  });

  it("nonEmptyPolicyNames caps at 50", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `policy-${i}`);
    expect(nonEmptyPolicyNames.safeParse(tooMany).success).toBe(false);
    expect(nonEmptyPolicyNames.safeParse(tooMany.slice(0, 50)).success).toBe(true);
  });
});

describe("aco_toggle_policy — no-op at the already-held state", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-toggle-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("issues no updatePolicy for a policy already at the target enabled state", async () => {
    persistValidBearer(configDir);
    const { client, calls } = buildClient(
      { "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [], enabled: true }] }) },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const toggle = tools.find((t) => t.name === "aco_toggle_policy")!;

    const result = await toggle.invoke({ mode: "named", names: ["outdoor-gear-discount"], enabled: true }, {});

    expect(result.isError).toBeUndefined();
    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"changed":false');
  });

  it("mutates rather than claiming a no-op when Adobe omits `enabled` entirely", async () => {
    // The reverse-engineered CLI's own ListPolicies query has no `enabled`
    // field, so a real tenant may return policies without it. Claiming
    // "changed: false" there would tell an agent the policy is already in the
    // requested state when nothing is actually known — the one outcome worse
    // than an extra write. This is the absent-field case; the tests around it
    // all set `enabled` explicitly.
    persistValidBearer(configDir);
    const { client, calls } = buildClient(
      {
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [] }] }),
        "POST /admin/graphql UpdatePolicy": graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } }),
      },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const toggle = tools.find((t) => t.name === "aco_toggle_policy")!;

    const result = await toggle.invoke({ mode: "named", names: ["outdoor-gear-discount"], enabled: true }, {});

    expect(result.isError).toBeUndefined();
    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(1);
    expect(result.content[0]?.text ?? "").toContain('"changed":true');
  });

  it("issues updatePolicy when the target state differs from the current one", async () => {
    persistValidBearer(configDir);
    const { client, calls } = buildClient(
      {
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [], enabled: false }] }),
        "POST /admin/graphql UpdatePolicy": graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } }),
      },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const toggle = tools.find((t) => t.name === "aco_toggle_policy")!;

    const result = await toggle.invoke({ mode: "named", names: ["outdoor-gear-discount"], enabled: true }, {});

    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(1);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"changed":true');
  });
});

describe("Tier boundary (design.md, Decision 0) — no admin credential resolvable", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-tier-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("Tier-A tools succeed and all four Tier-B tools return isError:true naming hiberus-aco auth token set — six invoke() calls, no hang", async () => {
    const { client } = buildClient(
      {
        "POST /graphql SearchCatalog": graphQlOk({ productSearch: { total_count: 0, items: [], facets: [] } }),
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "color", buckets: [{ value: "green", count: 1 }] }] } }),
      },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    const searchResult = await tools.find((t) => t.name === "aco_search_catalog")!.invoke({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "boots" }, {});
    const facetResult = await tools.find((t) => t.name === "aco_get_facet_values")!.invoke({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", attribute: "color" }, {});
    expect(searchResult.isError).toBeUndefined();
    expect(facetResult.isError).toBeUndefined();

    for (const name of TIER_B_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const args = name === "aco_toggle_policy" ? { mode: "named" as const, names: ["x"], enabled: true } : {};
      const result = await tool.invoke(args, {});
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/hiberus-aco auth token set/);
    }
  });

  it("relays a LIVE AdminScopeError as an actionable isError:true result, never an uncaught exception", async () => {
    // A stored (but valid-looking) Bearer so the admin transport actually
    // issues the request instead of failing pre-flight at getToken().
    persistValidBearer(configDir);

    const { client } = buildClient(
      { "POST /admin/graphql ListPolicies": graphQlErrors([{ message: "insufficient scope for this operation", extensions: { classification: "forbidden" } }]) },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    const result = await tools.find((t) => t.name === "aco_list_policies")!.invoke({}, {});

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/hiberus-aco auth mint/);
    expect(text).toMatch(/hiberus-aco auth token set/);
    expect(text).toMatch(/insufficient scope for this operation/);
  });
});

describe("aco_get_facet_values — tool-layer boundary #2 against the sampling fallback (mirrors client-layer 2.8)", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-facets-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("a non-facetable attribute returns { facetable: false, reason } with exactly ONE request total", async () => {
    const { client, calls } = buildClient({ "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "color", buckets: [] }] } }) }, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    const result = await tools.find((t) => t.name === "aco_get_facet_values")!.invoke({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", attribute: "color" }, {});

    expect(calls).toHaveLength(1);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"facetable":false');
    expect(text).toContain('"reason"');
  });
});

describe("Merchandising-track tools send no authorization-shaped header for an unprotected view", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-headers-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  // EDS's forbidden header name is deliberately never spelled out literally
  // in this file — `client/purity.test.ts` source-scans the whole
  // `packages/aco/src/**` tree for it, and a mention here (even inside a
  // test title or a header-key lookup) would be a false trip of that guard.
  const EDS_HEADER_NAME = ["X", "Auth", "Token"].join("-");

  it("aco_search_catalog's request carries no Authorization/x-api-key header, nor EDS's own auth header", async () => {
    const { client, calls } = buildClient({ "POST /graphql SearchCatalog": graphQlOk({ productSearch: { total_count: 0, items: [], facets: [] } }) }, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    await tools.find((t) => t.name === "aco_search_catalog")!.invoke({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "boots" }, {});

    const headers = calls[0]?.headers ?? {};
    expect(headers["authorization"]).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers[EDS_HEADER_NAME.toLowerCase()]).toBeUndefined();
  });
});

describe("aco_list_catalog_views — the id an agent feeds back into the other tools", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-views-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  /**
   * `aco_search_catalog`/`aco_get_facet_values` take `viewId`, and this tool
   * is how an agent discovers one. It used to emit `channelId` — the admin
   * schema's own retired spelling — so an agent had to guess that the two
   * names meant the same identifier.
   */
  it("emits viewId, the exact key the other tools take as input", async () => {
    persistValidBearer(configDir);
    const { client } = buildClient(
      {
        "POST /admin/graphql ListCatalogViews": graphQlOk({
          catalogViews: [{ viewId: "acv-demo-outdoor-gear-eu", name: "outdoor_gear_eu_en", sources: [{ locale: "en_US" }], defaultPriceBookId: "acpb-demo-eur", policyIds: ["pol-demo-1"], protectionEnabled: false }],
        }),
      },
      configDir,
    );
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const listViews = tools.find((t) => t.name === "aco_list_catalog_views")!;

    const result = await listViews.invoke({}, {});

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { readonly views: readonly Record<string, unknown>[] };
    expect(payload.views).toHaveLength(1);
    expect(payload.views[0]?.["viewId"]).toBe("acv-demo-outdoor-gear-eu");
    expect(payload.views[0]).not.toHaveProperty("channelId");
    expect(payload.views[0]?.["locales"]).toEqual(["en_US"]);
  });

  it("still excludes _draft views by default and includes them on request", async () => {
    persistValidBearer(configDir);
    const views = [
      { viewId: "acv-demo-live", name: "outdoor_gear_eu_en", sources: [{ locale: "en_US" }] },
      { viewId: "acv-demo-draft", name: "outdoor_gear_eu_en_draft", sources: [{ locale: "en_US" }] },
    ];
    const { client } = buildClient({ "POST /admin/graphql ListCatalogViews": graphQlOk({ catalogViews: views }) }, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const listViews = tools.find((t) => t.name === "aco_list_catalog_views")!;

    const hidden = JSON.parse((await listViews.invoke({}, {})).content[0]?.text ?? "{}") as { readonly views: readonly { readonly viewId: string }[] };
    expect(hidden.views.map((v) => v.viewId)).toEqual(["acv-demo-live"]);

    const shown = JSON.parse((await listViews.invoke({ includeDrafts: true }, {})).content[0]?.text ?? "{}") as { readonly views: readonly { readonly viewId: string }[] };
    expect(shown.views.map((v) => v.viewId)).toEqual(["acv-demo-live", "acv-demo-draft"]);
  });

  it("names viewId, not channelId, in its description — an agent picks arguments by description", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    const listViews = tools.find((t) => t.name === "aco_list_catalog_views")!;

    expect(listViews.description).toContain("viewId");
    expect(listViews.description).not.toContain("channelId");
  });
});

describe("Descriptions state WHEN to use the tool, and only Tier-B names the credential recovery", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-desc-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("every description is non-empty; Tier-B descriptions name hiberus-aco auth token set; Tier-A descriptions do not", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
    for (const name of TIER_B_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.description).toMatch(/hiberus-aco auth token set/);
    }
    for (const name of TIER_A_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.description).not.toMatch(/hiberus-aco auth token set/);
    }
  });
});

describe("Annotations match declared read/destructive/idempotent semantics", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-annotations-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("the five non-mutating tools are true/false/true; aco_toggle_policy is false/true/true", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    for (const name of [...TIER_A_TOOLS, "aco_list_catalog_views", "aco_list_price_books", "aco_list_policies"] as const) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    const toggle = tools.find((t) => t.name === "aco_toggle_policy")!;
    expect(toggle.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });
});
