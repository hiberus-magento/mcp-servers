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
import { findFiltersByAttribute, projectPolicyForUpdate, withFilterEnabled } from "../policy-update.js";

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

/**
 * `mode` is kept (not dropped) so the *absence* of an `"all"` branch is
 * legible on the wire as `"enum": ["named"]` in the JSON Schema an agent
 * reads (design.md, Decision 3). `z.literal("named")` is the ONLY literal —
 * there is no second one, and none may ever be added without a reviewable,
 * named diff to this exact line.
 *
 * CHANGED DELIBERATELY: this was `{ mode, names: string[], enabled }` on
 * `aco_toggle_policy`, a list of up to 50 POLICY names. There is no
 * policy-level enable/disable in this API — `UpdatePolicyRequest` has no
 * `enabled` member, and the ACO Admin UI offers enable/disable on a FILTER
 * only — so a toggle is a whole-policy replacement with one filter flipped.
 * One target per call: batching fifty whole-policy replacements behind one
 * call multiplies the blast radius of a destructive write.
 *
 * A filter has no id, so it is addressed by the `attribute` it carries
 * within the named policy. An attribute matching more than one filter is
 * refused, never guessed at.
 */
export const acoTogglePolicyFilterInput = z
  .object({
    mode: z.literal("named"),
    policyName: z.string().min(1),
    attribute: z.string().min(1),
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

/**
 * `aco_toggle_policy_filter`'s result. `previous` is absent when no write
 * was attempted at all (`reason` says why); `changed: false` with a
 * `previous` is the genuine no-op at the already-held state.
 */
interface PolicyFilterToggleResult {
  readonly policyName: string;
  readonly attribute: string;
  readonly previous?: boolean;
  readonly current: boolean;
  readonly changed: boolean;
  readonly reason?: string;
}

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
    description: `Use this to discover the catalog views (viewId, locales, default price book, policies) available in this tenant — most other tools need a viewId as input, and this is how an agent finds one. Draft views are excluded by default; set includeDrafts to see them. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoListCatalogViewsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      try {
        const result = await client.catalogViews.listCatalogViews();
        const includeDrafts = args.includeDrafts ?? false;
        // Projected field by field, not spread: `CatalogViewResult` carries
        // more than an agent needs to pick a view (`allowedPriceBookIds`,
        // `restrictedAccessKeyIds`, `layers`), and a spread would widen this
        // tool's output every time the wire narrowing grows a field.
        const views = result.views
          .filter((view) => includeDrafts || view.name === undefined || !DRAFT_VIEW_PATTERN.test(view.name))
          .map((view) => ({
            viewId: view.viewId,
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
    description: `Use this to list every policy configured in this tenant with its actions and filters, before deciding which filter to enable or disable with aco_toggle_policy_filter. ${TIER_B_RECOVERY_SENTENCE}`,
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

  const acoTogglePolicyFilter = defineTool({
    name: "aco_toggle_policy_filter",
    description: `Use this to enable or disable ONE filter inside ONE named policy, addressed by the attribute that filter carries (list them first with aco_list_policies). There is no policy-level enable/disable in this API and no "apply to all" mode. The write replaces the whole policy, so this reads it first and sends every other field back unchanged; if the read did not return a field the write must carry, or the attribute matches no filter or more than one, nothing is written and the result says why. A filter already at the target state is left untouched and reported with changed: false. ${TIER_B_RECOVERY_SENTENCE}`,
    inputSchema: acoTogglePolicyFilterInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async (args) => {
      const { client } = getRuntime();
      const refuse = (reason: string): PolicyFilterToggleResult => ({ policyName: args.policyName, attribute: args.attribute, current: args.enabled, changed: false, reason });
      try {
        const { policies } = await client.policies.listPolicies();
        const policy = policies.find((candidate) => candidate.name === args.policyName);
        if (policy === undefined) {
          return refuse(`No policy named "${args.policyName}" was found.`);
        }

        const matches = findFiltersByAttribute(policy, args.attribute);
        if (matches.length > 1) {
          // Addressing is by attribute because filters have no id. Picking
          // one of several would write the whole policy back on a guess.
          return refuse(`Policy "${args.policyName}" has ${String(matches.length)} filters on attribute "${args.attribute}"; this tool addresses filters by attribute and will not guess which one you mean.`);
        }
        const match = matches[0];
        if (match === undefined) {
          return refuse(`Policy "${args.policyName}" has no filter on attribute "${args.attribute}".`);
        }

        if (match.filter.enabled === args.enabled) {
          return { policyName: args.policyName, attribute: args.attribute, previous: match.filter.enabled, current: args.enabled, changed: false };
        }

        // `updatePolicy` REPLACES the policy, so an unprojectable field is
        // not a field we can default past: writing a guessed value into a
        // whole-policy replacement destroys the real one. Refuse instead.
        const projection = projectPolicyForUpdate(withFilterEnabled(policy, match, args.enabled));
        if (!projection.ok) {
          return refuse(`Policy "${args.policyName}" cannot be written back without losing data: the read returned no value for ${projection.missing.join(", ")}. Nothing was written.`);
        }

        await client.policies.updatePolicy(projection.input);
        return { policyName: args.policyName, attribute: args.attribute, previous: match.filter.enabled, current: args.enabled, changed: true };
      } catch (error) {
        relayCredentialFailure(error);
      }
    },
  });

  return [acoSearchCatalog, acoGetFacetValues, acoListCatalogViews, acoListPriceBooks, acoListPolicies, acoTogglePolicyFilter];
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
