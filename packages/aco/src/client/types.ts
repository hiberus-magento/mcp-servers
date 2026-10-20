// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Tolerant, hand-written wire narrowing (design.md, Decision 4's deliberate
// INVERSION of the wire-gate rule): GraphQL responses are validated with
// hand-written narrowing, never zod, and are NOT `.strict()` — an
// unanticipated field must pass through, not crash the client, because we do
// not own Adobe's undocumented admin schema. Do not conflate this with
// Phase 5's MCP tool-input `.strict()` schemas, which is the opposite rule
// for the opposite reason: we DO own that contract.
//
// A missing OPTIONAL field resolves to `undefined`. A missing KEYED field —
// one the six tools rely on to identify a row — throws
// `AcoSchemaMismatchError` naming the operation and the field path, per
// design.md Decision 4's "fails loudly, named, and with the file to edit"
// rule. Every parser here is the sole place its operation's shape is
// narrowed; `operations/*.ts` calls into these and nowhere else.
import { AcoSchemaMismatchError } from "./errors.js";
import type { ClassifiedData } from "./graphql.js";
import type { ScrollPage } from "./cursor.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function optionalStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function requireString(record: Record<string, unknown>, key: string, operationName: string, fieldPath: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AcoSchemaMismatchError({ operationName, fieldPath });
  }
  return value;
}

/**
 * Spreads `{ [key]: value }` only when `value` is defined, and spreads to
 * nothing otherwise — required under this project's `exactOptionalPropertyTypes`,
 * where an optional field must be ABSENT, not present-with-value-`undefined`.
 */
function withOptional<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return value !== undefined ? ({ [key]: value } as { readonly [P in K]?: V }) : ({} as { readonly [P in K]?: V });
}

// ---------------------------------------------------------------------------
// ListScopes — `{ scopes { locale } }` (exploration.md, `Q_SOURCES`). Used by
// `provision`'s validate-attribute step to confirm a target locale is
// configured before probing product counts against it. No keyed field: an
// entry with no `locale` is simply dropped, never a schema-mismatch throw —
// nothing downstream identifies a row by this shape.
// ---------------------------------------------------------------------------
export interface ScopeWire {
  readonly locale?: string;
}

export interface ListScopesResult {
  readonly scopes: readonly ScopeWire[];
}

export function parseListScopesResult(data: ClassifiedData<unknown>): ListScopesResult {
  const record = asRecord(data);
  const scopes = asArray(record["scopes"]).map((entry) => {
    const scopeRecord = asRecord(entry);
    return { ...withOptional("locale", optionalString(scopeRecord, "locale")) };
  });
  return { scopes };
}

// ---------------------------------------------------------------------------
// ListCatalogViews — `Q_VIEWS` (exploration.md). Keyed field: `viewId` only.
// `locales` is derived from `sources[].locale` (design.md, Decision 3's tool
// output shape flattens the wire's per-source array into `locales`).
//
// CHANGED DELIBERATELY: this parser read `channels[].channelId` and
// `scopes[].locale` until the admin schema renamed all three
// (`operations/catalog-views.ts` records what was verified against the live
// endpoint). The old spelling is gone rather than accepted alongside the
// new one: a parser that silently tolerates both teaches the next reader
// that either is still a live shape, and this package has already shipped
// one wrong model of this schema.
// ---------------------------------------------------------------------------

/** `layers[].source` — the per-layer origin, distinct from a view's own `sources`. */
export interface CatalogViewLayerSource {
  readonly locale?: string;
  readonly layer?: string;
}

export interface CatalogViewLayer {
  readonly order?: number;
  readonly source?: CatalogViewLayerSource;
}

export interface CatalogViewResult {
  readonly viewId: string;
  readonly name?: string;
  readonly locales: readonly string[];
  readonly defaultPriceBookId?: string;
  readonly policyIds?: readonly string[];
  readonly protectionEnabled?: boolean;
  readonly allowedPriceBookIds?: readonly string[];
  /** Identifiers of the access keys a protected view is restricted to — ids, never key material. */
  readonly restrictedAccessKeyIds?: readonly string[];
  /**
   * The API's own draft flag, and the ONLY thing that makes a view a draft.
   * It is optional like every other non-keyed field, so an absent `draft`
   * is `undefined` — not `false`. Callers must treat "unknown" as its own
   * answer: `cli.ts`'s `view prune` deletes only on `=== true`.
   */
  readonly draft?: boolean;
  readonly layers?: readonly CatalogViewLayer[];
}

export interface ListCatalogViewsResult {
  readonly views: readonly CatalogViewResult[];
}

function parseCatalogViewLayer(entry: unknown): CatalogViewLayer {
  const layerRecord = asRecord(entry);
  const sourceValue = layerRecord["source"];
  const source =
    sourceValue !== null && typeof sourceValue === "object"
      ? { ...withOptional("locale", optionalString(asRecord(sourceValue), "locale")), ...withOptional("layer", optionalString(asRecord(sourceValue), "layer")) }
      : undefined;
  return { ...withOptional("order", optionalNumber(layerRecord, "order")), ...withOptional("source", source) };
}

export function parseListCatalogViewsResult(data: ClassifiedData<unknown>, operationName: string): ListCatalogViewsResult {
  const record = asRecord(data);
  const views = asArray(record["catalogViews"]).map((entry) => {
    const viewRecord = asRecord(entry);
    const viewId = requireString(viewRecord, "viewId", operationName, "catalogViews[].viewId");
    const locales = asArray(viewRecord["sources"])
      .map((source) => optionalString(asRecord(source), "locale"))
      .filter((locale): locale is string => locale !== undefined);
    const layersValue = viewRecord["layers"];
    const layers = Array.isArray(layersValue) ? layersValue.map(parseCatalogViewLayer) : undefined;
    return {
      viewId,
      locales,
      ...withOptional("name", optionalString(viewRecord, "name")),
      ...withOptional("defaultPriceBookId", optionalString(viewRecord, "defaultPriceBookId")),
      ...withOptional("policyIds", optionalStringArray(viewRecord, "policyIds")),
      ...withOptional("protectionEnabled", optionalBoolean(viewRecord, "protectionEnabled")),
      ...withOptional("allowedPriceBookIds", optionalStringArray(viewRecord, "allowedPriceBookIds")),
      ...withOptional("restrictedAccessKeyIds", optionalStringArray(viewRecord, "restrictedAccessKeyIds")),
      ...withOptional("draft", optionalBoolean(viewRecord, "draft")),
      ...withOptional("layers", layers),
    };
  });
  return { views };
}

// ---------------------------------------------------------------------------
// ListPolicies — `Q_POLICIES` (exploration.md). Keyed fields: `policyId` AND
// `name` (both are relied on — `provision`'s policy step looks entries up by
// `name`, and `aco_toggle_policy_filter` addresses them by `name` and writes
// them back by `policyId`).
//
// CHANGED DELIBERATELY: `actions` used to be passed through as an opaque
// `readonly unknown[]`, on the grounds that no tool inspected it. One does
// now, and more than inspects it: `updatePolicy` REPLACES the policy it is
// given, so this read is the first half of a read-modify-write and every
// field it fails to carry is destroyed by the next write. The whole tree is
// narrowed field by field for that reason, and `policy-update.ts` projects
// it back into the mutation's input.
//
// `PolicyResult.enabled` is gone with it. `PolicyResponse` has no state
// field of any name — asking for one fails the whole query — so nothing on
// the wire could ever populate it. Enable/disable exists on a FILTER, which
// is `PolicyFilter.enabled` below and is real.
// ---------------------------------------------------------------------------

/** One `actions[].triggers[]` entry. Written back verbatim. */
export interface PolicyTrigger {
  readonly name?: string;
  readonly transportType?: string;
}

/**
 * One `actions[].filters[]` entry — the thing an operator enables or
 * disables in the ACO Admin UI.
 *
 * `values` (plural) is the list the UI sends. `value` (singular) is read but
 * NEVER written back: the only evidence of `UpdatePolicyRequest`'s shape is
 * the UI's own Save, which sends the other five members and no `value`, and
 * an input member that type does not declare fails the whole mutation.
 * `policy-update.ts` carries the full reasoning.
 */
export interface PolicyFilter {
  readonly attribute?: string;
  readonly values?: readonly string[];
  readonly value?: string;
  readonly enabled?: boolean;
  readonly actionFilterOperator?: string;
  readonly valueSource?: string;
}

export interface PolicyAction {
  readonly triggers?: readonly PolicyTrigger[];
  readonly filters?: readonly PolicyFilter[];
}

export interface PolicyResult {
  readonly policyId: string;
  readonly name: string;
  readonly mandatory?: boolean;
  readonly actions?: readonly PolicyAction[];
}

export interface ListPoliciesResult {
  readonly policies: readonly PolicyResult[];
}

function parsePolicyTrigger(entry: unknown): PolicyTrigger {
  const triggerRecord = asRecord(entry);
  return { ...withOptional("name", optionalString(triggerRecord, "name")), ...withOptional("transportType", optionalString(triggerRecord, "transportType")) };
}

function parsePolicyFilter(entry: unknown): PolicyFilter {
  const filterRecord = asRecord(entry);
  return {
    ...withOptional("attribute", optionalString(filterRecord, "attribute")),
    ...withOptional("values", optionalStringArray(filterRecord, "values")),
    ...withOptional("value", optionalString(filterRecord, "value")),
    ...withOptional("enabled", optionalBoolean(filterRecord, "enabled")),
    ...withOptional("actionFilterOperator", optionalString(filterRecord, "actionFilterOperator")),
    ...withOptional("valueSource", optionalString(filterRecord, "valueSource")),
  };
}

function parsePolicyAction(entry: unknown): PolicyAction {
  const actionRecord = asRecord(entry);
  const triggersValue = actionRecord["triggers"];
  const filtersValue = actionRecord["filters"];
  return {
    ...withOptional("triggers", Array.isArray(triggersValue) ? triggersValue.map(parsePolicyTrigger) : undefined),
    ...withOptional("filters", Array.isArray(filtersValue) ? filtersValue.map(parsePolicyFilter) : undefined),
  };
}

export function parseListPoliciesResult(data: ClassifiedData<unknown>, operationName: string): ListPoliciesResult {
  const record = asRecord(data);
  const policies = asArray(record["policies"]).map((entry) => {
    const policyRecord = asRecord(entry);
    const policyId = requireString(policyRecord, "policyId", operationName, "policies[].policyId");
    const name = requireString(policyRecord, "name", operationName, "policies[].name");
    const actionsValue = policyRecord["actions"];
    const actions = Array.isArray(actionsValue) ? actionsValue.map(parsePolicyAction) : undefined;
    return {
      policyId,
      name,
      ...withOptional("mandatory", optionalBoolean(policyRecord, "mandatory")),
      ...withOptional("actions", actions),
    };
  });
  return { policies };
}

// ---------------------------------------------------------------------------
// ListPriceBooks — `Q_PBOOKS` (exploration.md). Keyed field:
// `priceBooks.items[].id`. The only cursor-paginated query — `scrollId`
// round-trips through `ScrollPage<PriceBookResult>` (cursor.ts).
// ---------------------------------------------------------------------------
export interface PriceBookResult {
  readonly id: string;
  readonly name?: string;
  readonly currency?: string;
  readonly level?: string;
  readonly parentIds?: readonly string[];
}

export type ListPriceBooksResult = ScrollPage<PriceBookResult>;

export function parseListPriceBooksResult(data: ClassifiedData<unknown>, operationName: string): ListPriceBooksResult {
  const record = asRecord(data);
  const priceBooksRecord = asRecord(record["priceBooks"]);
  const items = asArray(priceBooksRecord["items"]).map((entry) => {
    const itemRecord = asRecord(entry);
    const id = requireString(itemRecord, "id", operationName, "priceBooks.items[].id");
    return {
      id,
      ...withOptional("name", optionalString(itemRecord, "name")),
      ...withOptional("currency", optionalString(itemRecord, "currency")),
      ...withOptional("level", optionalString(itemRecord, "level")),
      ...withOptional("parentIds", optionalStringArray(itemRecord, "parentIds")),
    };
  });
  const scrollId = optionalString(priceBooksRecord, "scrollId");
  return { items, ...withOptional("scrollId", scrollId) };
}

// ---------------------------------------------------------------------------
// SearchCatalog — `productSearch` (exploration.md). No keyed field: a search
// result with an unrecognized shape degrades to empty totals/items rather
// than throwing, because nothing downstream identifies a row by this shape
// the way `viewId`/`policyId`/`id` are relied on elsewhere.
// ---------------------------------------------------------------------------
export interface SearchCatalogItem {
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * One entry of `Aggregation.buckets`, which is of the INTERFACE type
 * `Bucket`. `title` is the interface's ONLY common field — the bucket label.
 * Everything else comes from one implementation and is therefore optional
 * here:
 *
 *   - `count` — `ScalarBucket`, `RangeBucket`, `CategoryBucket`
 *   - `from`/`to` — `RangeBucket`
 *   - `min`/`max` — `StatsBucket`, which has NO `count`
 *
 * `count` must stay optional rather than defaulting to `0`: a `StatsBucket`
 * reports a range, and "no counted values" is a different claim from "zero
 * products match".
 *
 * CHANGED DELIBERATELY: this read `value`, a field no `Bucket`
 * implementation has. It is gone rather than accepted alongside `title` —
 * nothing on the wire can produce it, and tolerating it would teach the
 * next reader that it is still a live shape.
 */
export interface SearchCatalogBucket {
  readonly title?: string;
  readonly count?: number;
  readonly from?: number;
  readonly to?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface SearchCatalogFacet {
  readonly attribute?: string;
  readonly title?: string;
  readonly buckets?: readonly SearchCatalogBucket[];
}

export interface SearchCatalogResult {
  readonly totalCount: number;
  readonly items: readonly SearchCatalogItem[];
  readonly facets: readonly SearchCatalogFacet[];
}

function parseBucket(bucket: unknown): SearchCatalogBucket {
  const bucketRecord = asRecord(bucket);
  return {
    ...withOptional("title", optionalString(bucketRecord, "title")),
    ...withOptional("count", optionalNumber(bucketRecord, "count")),
    ...withOptional("from", optionalNumber(bucketRecord, "from")),
    ...withOptional("to", optionalNumber(bucketRecord, "to")),
    ...withOptional("min", optionalNumber(bucketRecord, "min")),
    ...withOptional("max", optionalNumber(bucketRecord, "max")),
  };
}

function parseFacet(entry: unknown): SearchCatalogFacet {
  const facetRecord = asRecord(entry);
  const buckets = asArray(facetRecord["buckets"]).map(parseBucket);
  return { ...withOptional("attribute", optionalString(facetRecord, "attribute")), ...withOptional("title", optionalString(facetRecord, "title")), buckets };
}

export function parseSearchCatalogResult(data: ClassifiedData<unknown>): SearchCatalogResult {
  const record = asRecord(data);
  const searchRecord = asRecord(record["productSearch"]);
  const items = asArray(searchRecord["items"]).map((entry) => {
    const itemRecord = asRecord(entry);
    const productView = asRecord(itemRecord["productView"]);
    const attributesArray = asArray(productView["attributes"]);
    const attributes: Record<string, unknown> = {};
    for (const attribute of attributesArray) {
      const attributeRecord = asRecord(attribute);
      const name = optionalString(attributeRecord, "name");
      if (name !== undefined) {
        attributes[name] = attributeRecord["value"];
      }
    }
    return { attributes };
  });
  const facets = asArray(searchRecord["facets"]).map(parseFacet);
  return { totalCount: optionalNumber(searchRecord, "total_count") ?? 0, items, facets };
}

// ---------------------------------------------------------------------------
// FacetValues — its own named query (design.md, Decision 3), always exactly
// one request. `FacetValuesResult` is a closed union: a non-facetable
// attribute (no bucket data) returns a structured negative result rather
// than throwing or falling back to sampling (`operations/facets.ts` owns the
// facetable/non-facetable decision; this module only narrows the wire shape).
// ---------------------------------------------------------------------------
export interface FacetValueEntry {
  readonly value: string;
  readonly count: number;
}

export type FacetValuesResult = { readonly facetable: true; readonly values: readonly FacetValueEntry[] } | { readonly facetable: false; readonly reason: string };

export function parseFacetValuesWire(data: ClassifiedData<unknown>): readonly SearchCatalogFacet[] {
  const record = asRecord(data);
  const searchRecord = asRecord(record["productSearch"]);
  return asArray(searchRecord["facets"]).map(parseFacet);
}
