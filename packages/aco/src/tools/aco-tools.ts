// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The six `aco_*` tools as TYPES (design.md, Decision 3). Lives in its own
// module, separate from `mcp.ts`, for exactly one reason (mirrors
// `eds/src/tools/eds-tools.ts`): `mcp.ts` must call
// `server.connect(transport)` UNCONDITIONALLY at module top level, so a
// module that connects on import cannot also be imported safely by unit
// tests. This module has NO side effects — it only exports schemas and a
// factory function — so `aco-tools.test.ts`/`mcp.test-d.ts` import it
// directly, and `mcp.ts` is the only file that ever imports it AND
// triggers the connect.
//
// Two-tier surface (design.md, Decision 0): Tier A (`aco_search_catalog`,
// `aco_get_facet_values`) needs no credential for an unprotected view and
// stays alive for the life of the process. Tier B (the four admin-backed
// tools) resolves the admin credential PER CALL via `credential-provider.ts`
// — never cached here — so a credential added or replaced while the server
// is running takes effect on the very next call, no restart. Every Tier-B
// handler routes its failure through `relayCredentialFailure` (3.6): the
// ONLY place a live `AdminScopeError` becomes the `CredentialExpiredError`
// that `defineTool.invoke` (mcp-core, read-only) already catches.
import { defineTool, type RegisteredTool } from "@hiberus-magento/mcp-core";
import { z } from "zod";
import { createAcoClient, type AcoClient } from "../client/index.js";
import { createAdminTokenProvider, relayCredentialFailure } from "../credential-provider.js";

// ---------------------------------------------------------------------------
// Schemas — all `.strict()` (design.md, Decision 3: deliberate inverse of
// `client/types.ts`'s TOLERANT wire parsing; MCP tool inputs are the wire
// gate for untrusted agent input, and we DO own this contract).
// ---------------------------------------------------------------------------

const acoSearchCatalogInput = z
  .object({
    viewId: z.string().min(1),
    locale: z.string().min(1),
    phrase: z.string().min(1),
    pageSize: z.number().int().min(1).max(100).optional(),
    currentPage: z.number().int().min(1).optional(),
    priceBookId: z.string().min(1).optional(),
  })
  .strict();

const acoGetFacetValuesInput = z
  .object({
    viewId: z.string().min(1),
    locale: z.string().min(1),
    attribute: z.string().min(1),
    priceBookId: z.string().min(1).optional(),
  })
  .strict();

const acoListCatalogViewsInput = z
  .object({
    includeDrafts: z.boolean().optional(),
  })
  .strict();

const acoListPriceBooksInput = z
  .object({
    size: z.number().int().min(1).max(200).optional(),
    searchTerm: z.string().min(1).optional(),
    scrollId: z.string().min(1).optional(),
  })
  .strict();

const acoListPoliciesInput = z.object({}).strict();

/** `.min(1).max(50)` — capped in-schema (design.md, Decision 3). */
export const nonEmptyPolicyNames = z.array(z.string().min(1)).min(1).max(50);

/**
 * `mode` is kept (not dropped) so the *absence* of an `"all"` branch is
 * legible on the wire as `"enum": ["named"]` in the JSON Schema an agent
 * reads (design.md, Decision 3). `z.literal("named")` is the ONLY literal —
 * there is no second one, and none may ever be added without a reviewable,
 * named diff to this exact line.
 */
export const acoTogglePolicyInput = z
  .object({
    mode: z.literal("named"),
    names: nonEmptyPolicyNames,
    enabled: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool factory — a pure function of an already-constructed `AcoClient`, so
// it is unit-testable without spawning a process or resolving a real
// credential (`aco-tools.test.ts` passes a client built over `FetchDouble`).
// ---------------------------------------------------------------------------

/** Only the surface `mcp.ts`'s registration loop and tests need. */
export type AcoMcpTool = Pick<RegisteredTool<z.ZodObject, unknown>, "name" | "description" | "inputSchema" | "annotations" | "invoke">;

export interface AcoRuntime {
  readonly client: AcoClient;
}

export interface AcoToolsConfig {
  /** Resolved lazily, on the FIRST tool call, not at registration time — mirrors `eds`'s `EdsToolsConfig`. */
  readonly getRuntime: () => AcoRuntime;
}

const DRAFT_VIEW_PATTERN = /_draft$/i;

const TIER_B_RECOVERY_SENTENCE =
  "Requires an ACO admin credential; if it has expired, run `hiberus-aco auth token set` and retry — the server does not need restarting.";

function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]: V } | Record<string, never> {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

export function createAcoTools(config: AcoToolsConfig): readonly AcoMcpTool[] {
  const { getRuntime } = config;

  const acoSearchCatalog = defineTool({
    name: "aco_search_catalog",
    description:
      "Use this to search a catalog view's products by phrase and page through results, with facet buckets included. The highest-value read for exploring what a view's catalog contains. Read-only, and no credential is required for an unprotected view.",
    inputSchema: acoSearchCatalogInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      return client.search.searchCatalog({
        viewId: args.viewId,
        locale: args.locale,
        phrase: args.phrase,
        ...present("pageSize", args.pageSize),
        ...present("currentPage", args.currentPage),
        ...present("priceBookId", args.priceBookId),
      });
    },
  });

  const acoGetFacetValues = defineTool({
    name: "aco_get_facet_values",
    description:
      'Use this to check whether an attribute is facetable for a catalog view and list its available values with counts, before filtering aco_search_catalog by it. Returns { facetable: false, reason } for a non-facetable attribute rather than guessing — never falls back to sampling product pages. Read-only, and no credential is required for an unprotected view.',
    inputSchema: acoGetFacetValuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      return client.facets.getFacetValues({
        viewId: args.viewId,
        locale: args.locale,
        attribute: args.attribute,
        ...present("priceBookId", args.priceBookId),
      });
    },
  });

  const acoListCatalogViews = defineTool({
    name: "aco_list_catalog_views",
    description: `Use this to discover the catalog views (channelId, locales, default price book, policies) available in this tenant — most other tools need a viewId as input, and this is how an agent finds one. Draft views are excluded by default; set includeDrafts to see them. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoListCatalogViewsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      try {
        const result = await client.channels.listChannels();
        const includeDrafts = args.includeDrafts ?? false;
        const views = result.views
          .filter((view) => includeDrafts || view.name === undefined || !DRAFT_VIEW_PATTERN.test(view.name))
          .map((view) => ({
            channelId: view.channelId,
            ...present("name", view.name),
            locales: view.locales,
            ...present("defaultPriceBookId", view.defaultPriceBookId),
            policyIds: view.policyIds ?? [],
            ...present("protectionEnabled", view.protectionEnabled),
          }));
        return { views };
      } catch (error) {
        relayCredentialFailure(error);
      }
    },
  });

  const acoListPriceBooks = defineTool({
    name: "aco_list_price_books",
    description: `Use this to list price books, optionally filtered by searchTerm, and to page through more with the returned scrollId — pass it back in as scrollId to continue; this tool never auto-drains the whole list. The only cursor-paginated tool in this server. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoListPriceBooksInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      try {
        return await client.priceBooks.listPriceBooks({
          ...present("size", args.size),
          ...present("searchTerm", args.searchTerm),
          ...present("scrollId", args.scrollId),
        });
      } catch (error) {
        relayCredentialFailure(error);
      }
    },
  });

  const acoListPolicies = defineTool({
    name: "aco_list_policies",
    description: `Use this to list every policy configured in this tenant, before deciding which to enable or disable with aco_toggle_policy. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoListPoliciesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async () => {
      const { client } = getRuntime();
      try {
        return await client.policies.listPolicies();
      } catch (error) {
        relayCredentialFailure(error);
      }
    },
  });

  const acoTogglePolicy = defineTool({
    name: "aco_toggle_policy",
    description: `Use this to enable or disable one or more named policies. There is no "apply to all" mode — name every policy explicitly. A policy already at the target state is left untouched and reported with changed: false. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoTogglePolicyInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      try {
        const { policies } = await client.policies.listPolicies();
        const byName = new Map(policies.map((policy) => [policy.name, policy]));
        const results: { readonly name: string; readonly previous: boolean | undefined; readonly current: boolean; readonly changed: boolean }[] = [];
        for (const name of args.names) {
          const existing = byName.get(name);
          if (existing === undefined) {
            results.push({ name, previous: undefined, current: args.enabled, changed: false });
            continue;
          }
          // `existing.enabled` is undefined when Adobe's schema does not
          // return it (a genuine, documented gap — types.ts's PolicyResult
          // comment) — in that case a no-op cannot be proven, so the
          // mutation is always issued rather than silently claiming
          // `changed: false` on unknown state.
          if (existing.enabled === args.enabled) {
            results.push({ name, previous: existing.enabled, current: args.enabled, changed: false });
            continue;
          }
          await client.policies.updatePolicy({ policyId: existing.policyId, enabled: args.enabled });
          results.push({ name, previous: existing.enabled, current: args.enabled, changed: true });
        }
        return { results };
      } catch (error) {
        relayCredentialFailure(error);
      }
    },
  });

  return [acoSearchCatalog, acoGetFacetValues, acoListCatalogViews, acoListPriceBooks, acoListPolicies, acoTogglePolicy];
}

// ---------------------------------------------------------------------------
// Runtime resolver — resolved LAZILY, on the first tool CALL, not at process
// startup, so `tools/list` keeps working even before the base URLs are set
// (mirrors `eds`'s `createRuntimeResolver`). A missing base URL is a
// configuration error, not a credential error, so it is allowed to
// propagate raw — exactly `eds`'s own precedent for a missing `EDS_ORG`.
// ---------------------------------------------------------------------------
const ADMIN_BASE_URL_ENV_VAR = "ACO_ADMIN_BASE_URL";
const MERCHANDISING_BASE_URL_ENV_VAR = "ACO_MERCHANDISING_BASE_URL";
const API_KEY_ENV_VAR = "ACO_API_KEY";
const IMS_ORG_ID_ENV_VAR = "ACO_IMS_ORG_ID";

export function createRuntimeResolver(): () => AcoRuntime {
  let runtime: AcoRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const adminBaseUrl = process.env[ADMIN_BASE_URL_ENV_VAR];
    const merchandisingBaseUrl = process.env[MERCHANDISING_BASE_URL_ENV_VAR];
    if (adminBaseUrl === undefined || adminBaseUrl.length === 0 || merchandisingBaseUrl === undefined || merchandisingBaseUrl.length === 0) {
      throw new Error(`hiberus-aco-mcp: ${ADMIN_BASE_URL_ENV_VAR} and ${MERCHANDISING_BASE_URL_ENV_VAR} are both required to call any aco_* tool. Set them and restart the server.`);
    }
    const client = createAcoClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      adminBaseUrl,
      merchandisingBaseUrl,
      tokenProvider: createAdminTokenProvider({ now: () => Date.now(), fetch: globalThis.fetch }),
      ...present("apiKey", process.env[API_KEY_ENV_VAR]),
      ...present("imsOrgId", process.env[IMS_ORG_ID_ENV_VAR]),
    });
    runtime = { client };
    return runtime;
  };
}
