// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 5). Covers: exactly six tools, asserted by
// count AND name (unit — the runtime proof; the built-bundle conformance
// proof is Phase 6, out of scope here); the CLI-only exclusion list has no
// corresponding tool name; `aco_toggle_policy_filter`'s runtime rejection
// of `mode: "all"` / an omitted target / unknown keys (the SECOND of three
// independent no-"all"-branch proofs — the first is `mcp.test-d.ts`, the
// third is Phase 6's built-bundle JSON Schema check); the LOSSLESSNESS of
// its whole-policy read-modify-write and the no-op-at-already-held-state
// requirement; the two-tier credential boundary (Tier A
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
import { createFetchDouble, graphQlErrors, graphQlOk, type RecordedCall } from "../testing/fetch-double.js";
import { CLI_ONLY_OPERATIONS } from "../cli.js";
import { acoTogglePolicyFilterInput, createAcoTools } from "./aco-tools.js";

const TIER_A_TOOLS = ["aco_search_catalog", "aco_get_facet_values"] as const;
const TIER_B_TOOLS = ["aco_list_catalog_views", "aco_list_price_books", "aco_list_policies", "aco_toggle_policy_filter"] as const;
const ALL_SIX = [...TIER_A_TOOLS, ...TIER_B_TOOLS] as const;

/**
 * A policy with every member `UpdatePolicyRequest` accepts populated, plus
 * the singular `value` the read selects and the write must not send. Two
 * filters and a trigger, so "everything else came back unchanged" is an
 * assertion with something to say.
 */
const FULL_POLICY_WIRE = {
  policyId: "pol-demo-1",
  name: "outdoor-gear-discount",
  mandatory: true,
  actions: [
    {
      triggers: [{ name: "on-catalog-read", transportType: "GRAPHQL" }],
      filters: [
        { attribute: "vertical", values: ["outdoor-gear"], value: "outdoor-gear", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC" },
        { attribute: "price_band", values: ["mid", "high"], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" },
      ],
    },
  ],
} as const;

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A JWT-shaped, unexpired, unsigned Bearer — enough for `PastedBearerProvider`'s expiry check to pass so an admin call actually reaches the fetch double. */
function persistValidBearer(configDir: string): void {
  const token = `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify({ created_at: Date.now() - 1_000, expires_in: 60_000 }))}.unsigned`;
  persistCredential("aco", token, configDir);
}

function buildClient(routes: Record<string, unknown>, configDir: string): { client: AcoClient; calls: readonly RecordedCall[] } {
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

// CHANGED DELIBERATELY — `aco_toggle_policy` is now
// `aco_toggle_policy_filter`, and this block's `names`-array cases moved
// with it:
//
//   - "safeParse rejects an empty names array", "rejects an omitted names
//     field" and "nonEmptyPolicyNames caps at 50" tested a list of POLICY
//     names, capped at 50. There is no policy-level enable/disable in this
//     API to apply to a list: disabling is a whole-policy replacement with
//     one filter flipped, and batching fifty of those behind one call
//     multiplies the blast radius of a destructive write and leaves no
//     honest answer when the twentieth fails. The tool addresses exactly
//     one filter in one policy, so there is no list to cap.
//   - `mode: "named"` is kept exactly as it was, and so are the three
//     independent no-`"all"`-branch proofs that read it.
describe('aco_toggle_policy_filter — the type is exactly `mode: "named"`, no all branch (runtime proof #2 of 3)', () => {
  const VALID = { mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true };

  it('safeParse rejects mode: "all"', () => {
    expect(acoTogglePolicyFilterInput.safeParse({ ...VALID, mode: "all" }).success).toBe(false);
  });

  it("safeParse rejects an omitted policyName", () => {
    expect(acoTogglePolicyFilterInput.safeParse({ mode: "named", attribute: "price_band", enabled: true }).success).toBe(false);
  });

  it("safeParse rejects an omitted attribute — a policy is not an addressable target on its own", () => {
    expect(acoTogglePolicyFilterInput.safeParse({ mode: "named", policyName: "outdoor-gear-discount", enabled: true }).success).toBe(false);
  });

  it("safeParse rejects an empty attribute", () => {
    expect(acoTogglePolicyFilterInput.safeParse({ ...VALID, attribute: "" }).success).toBe(false);
  });

  it("safeParse rejects an unknown key (.strict())", () => {
    expect(acoTogglePolicyFilterInput.safeParse({ ...VALID, extra: "nope" }).success).toBe(false);
  });

  it("safeParse accepts the valid shape", () => {
    expect(acoTogglePolicyFilterInput.safeParse(VALID).success).toBe(true);
  });
});

describe("aco_toggle_policy_filter — the write is a whole-policy replacement, so it must be lossless", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-tools-toggle-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function togglePolicyFilterTool(routes: Record<string, unknown>): { tool: ReturnType<typeof createAcoTools>[number]; calls: readonly RecordedCall[] } {
    persistValidBearer(configDir);
    const { client, calls } = buildClient(routes, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });
    return { tool: tools.find((t) => t.name === "aco_toggle_policy_filter")!, calls };
  }

  const UPDATE_OK = graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } });

  /**
   * THE test for this tool. `updatePolicy` REPLACES the policy, so a toggle
   * that sends back anything less than the whole policy silently deletes
   * the rest of it. One filter is flipped; every other field of the posted
   * request must be exactly what was read.
   */
  it("posts back every field of the policy unchanged, with only the addressed filter's `enabled` flipped", async () => {
    const { tool, calls } = togglePolicyFilterTool({
      "POST /admin/graphql ListPolicies": graphQlOk({ policies: [FULL_POLICY_WIRE] }),
      "POST /admin/graphql UpdatePolicy": UPDATE_OK,
    });

    const result = await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true }, {});

    expect(result.isError).toBeUndefined();
    const update = calls.find((call) => call.operationName === "UpdatePolicy");
    const posted = JSON.parse(update?.body ?? "{}") as { readonly variables?: { readonly policyRequest?: unknown } };
    expect(posted.variables?.policyRequest).toEqual({
      policyId: "pol-demo-1",
      name: "outdoor-gear-discount",
      mandatory: true,
      actions: [
        {
          triggers: [{ transportType: "GRAPHQL", name: "on-catalog-read" }],
          filters: [
            { attribute: "vertical", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC", values: ["outdoor-gear"] },
            { attribute: "price_band", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC", values: ["mid", "high"] },
          ],
        },
      ],
    });
    expect(result.content[0]?.text ?? "").toContain('"changed":true');
  });

  it("never puts the singular `value` on the wire — it is read-only, and an undeclared input member fails the whole mutation", async () => {
    const { tool, calls } = togglePolicyFilterTool({
      "POST /admin/graphql ListPolicies": graphQlOk({ policies: [FULL_POLICY_WIRE] }),
      "POST /admin/graphql UpdatePolicy": UPDATE_OK,
    });

    await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true }, {});

    expect(calls.find((call) => call.operationName === "UpdatePolicy")?.body ?? "").not.toContain('"value"');
  });

  it("issues no UpdatePolicy when the addressed filter already holds the target state", async () => {
    const { tool, calls } = togglePolicyFilterTool({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [FULL_POLICY_WIRE] }) });

    const result = await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "vertical", enabled: true }, {});

    expect(result.isError).toBeUndefined();
    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    expect(result.content[0]?.text ?? "").toContain('"changed":false');
  });

  /**
   * CHANGED DELIBERATELY: the superseded tool wrote on absent state, because
   * a policy-level `enabled` was never on the wire and an extra write was
   * the lesser evil. A FILTER's `enabled` IS on the wire and is a member the
   * write must send back, so an absent one is unknown state inside a
   * whole-policy replacement — writing a guessed `false` into it is data
   * loss, not an extra write. The tool refuses.
   */
  it("refuses, and writes nothing, when a field the write must send back was not read", async () => {
    const incomplete = { policyId: "pol-demo-1", name: "outdoor-gear-discount", actions: [{ triggers: [], filters: [{ attribute: "price_band", values: ["mid"], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" }] }] };
    const { tool, calls } = togglePolicyFilterTool({
      "POST /admin/graphql ListPolicies": graphQlOk({ policies: [incomplete] }),
      "POST /admin/graphql UpdatePolicy": UPDATE_OK,
    });

    const result = await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true }, {});

    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('"changed":false');
    expect(text).toContain("mandatory");
  });

  it("refuses when no filter carries the attribute, and names the attribute", async () => {
    const { tool, calls } = togglePolicyFilterTool({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [FULL_POLICY_WIRE] }) });

    const result = await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "colour", enabled: true }, {});

    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    expect(result.content[0]?.text ?? "").toContain("colour");
  });

  it("refuses rather than guessing when more than one filter carries the attribute", async () => {
    const twoMatches = {
      ...FULL_POLICY_WIRE,
      actions: [
        FULL_POLICY_WIRE.actions[0],
        { triggers: [], filters: [{ attribute: "price_band", values: ["low"], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" }] },
      ],
    };
    const { tool, calls } = togglePolicyFilterTool({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [twoMatches] }), "POST /admin/graphql UpdatePolicy": UPDATE_OK });

    const result = await tool.invoke({ mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true }, {});

    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    expect(result.content[0]?.text ?? "").toContain('"changed":false');
  });

  it("refuses when no policy carries the name", async () => {
    const { tool, calls } = togglePolicyFilterTool({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [FULL_POLICY_WIRE] }) });

    const result = await tool.invoke({ mode: "named", policyName: "home-decor-discount", attribute: "price_band", enabled: true }, {});

    expect(calls.filter((c) => c.operationName === "UpdatePolicy")).toHaveLength(0);
    expect(result.content[0]?.text ?? "").toContain("home-decor-discount");
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
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "color", buckets: [{ title: "green", count: 1 }] }] } }),
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
      const args = name === "aco_toggle_policy_filter" ? { mode: "named" as const, policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true } : {};
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

  it("the five non-mutating tools are true/false/true; aco_toggle_policy_filter is false/true/true", () => {
    const { client } = buildClient({}, configDir);
    const tools = createAcoTools({ getRuntime: () => ({ client }) });

    for (const name of [...TIER_A_TOOLS, "aco_list_catalog_views", "aco_list_price_books", "aco_list_policies"] as const) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    const toggle = tools.find((t) => t.name === "aco_toggle_policy_filter")!;
    expect(toggle.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });
});
