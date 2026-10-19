// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.8): `FacetValues` is its own named query, issued
// exactly once, and never falls back to the Python CLI's page-sampling loop
// (design.md, Decision 3) — client-layer structural boundary #1. A
// non-facetable attribute (a fixture with no bucket data for it) returns a
// structured `{ facetable: false, reason }` instead of throwing or
// triggering additional requests: `fetchDouble.calls` MUST have length
// exactly 1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { selectionOf } from "../../testing/operation-documents.js";
import { createMerchandisingTransport } from "../http.js";
import { getFacetValues } from "./facets.js";

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

const CONTEXT = { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US" };

// The two response fixtures (tasks.md 2.20) live in
// `packages/aco/fixtures/facets.json`, synthetic values only.
const FACETS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/facets.json", import.meta.url)), "utf8")) as {
  readonly facetable: { readonly productSearch: { readonly facets: readonly { readonly attribute: string; readonly buckets: readonly { readonly title: string; readonly count: number }[] }[] } };
  readonly nonFacetable: { readonly productSearch: { readonly facets: readonly { readonly attribute: string; readonly buckets: readonly unknown[] }[] } };
  readonly statsOnly: { readonly productSearch: { readonly facets: readonly { readonly attribute: string; readonly buckets: readonly { readonly title: string; readonly min: number; readonly max: number }[] }[] } };
};

describe("getFacetValues", () => {
  it("returns facet values and issues exactly one request when the attribute is facetable", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.facetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    const result = await getFacetValues(transport, { ...CONTEXT, attribute: "color" });

    // `FacetValueEntry.value` is this tool's own output name for a bucket
    // label; on the wire that label is `Bucket.title` (the interface's only
    // common field). The names differ on purpose — the tool contract did not
    // change when the wire selection was corrected.
    const expected = (FACETS_FIXTURE.facetable.productSearch.facets[0]?.buckets ?? []).map((bucket) => ({ value: bucket.title, count: bucket.count }));
    expect(result).toEqual({ facetable: true, values: expected });
    expect(calls).toHaveLength(1);
  });

  /**
   * A `StatsBucket` carries `min`/`max` and NO `count`. Reporting it as a
   * facet value with `count: 0` would tell an agent the attribute has a
   * value nothing matches, which is a different claim from "this facet
   * reports a range, not counted values".
   */
  it("does not invent a zero count for a bucket that has none (StatsBucket)", async () => {
    const { fetch } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.statsOnly),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    const result = await getFacetValues(transport, { ...CONTEXT, attribute: "price" });

    expect(result.facetable).toBe(false);
  });

  it("returns a structured non-facetable result — never a fallback — and issues exactly one request", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.nonFacetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    const result = await getFacetValues(transport, { ...CONTEXT, attribute: "size" });

    expect(result.facetable).toBe(false);
    if (!result.facetable) {
      expect(result.reason).toContain("size");
    }
    expect(calls).toHaveLength(1);
  });

  /**
   * The document text is part of the contract: the fetch double routes on
   * the operation NAME alone, so the version of this document that declared
   * `$attribute` and never referenced it passed both tests above while
   * being invalid against every GraphQL server (the live service answered
   * `Variable "$attribute" is never used.`). The attribute is a client-side
   * selection over the one response, never a query variable.
   */
  it("posts a document with no variables, and sends none — the attribute selects from the result", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.facetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    await getFacetValues(transport, { ...CONTEXT, attribute: "color" });

    const posted = JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string; readonly variables?: Readonly<Record<string, unknown>> };
    expect(posted.query ?? "").not.toContain("$");
    expect(posted.variables).toEqual({});
  });

  /**
   * Same defect as `SearchCatalog`'s, in a second document: `buckets` is of
   * the INTERFACE type `Bucket`, whose only common field is `title`. With
   * `value` (on no implementation) and `count` (reachable only through a
   * fragment) as the whole selection, every selected subfield is invalid and
   * the service answers `Field "buckets" of type "Aggregation" must have a
   * selection of subfields`.
   */
  it("selects the Bucket interface's own `title` plus the count-bearing inline fragments, and never `value`", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.facetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    await getFacetValues(transport, { ...CONTEXT, attribute: "color" });

    const document = (JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string }).query ?? "";
    const { fields, fragmentFields } = selectionOf(document, "buckets");
    expect(fields).toEqual(["title"]);
    expect(fields).not.toContain("value");
    expect(fragmentFields).toEqual({
      ScalarBucket: ["count"],
      RangeBucket: ["count", "from", "to"],
      CategoryBucket: ["count"],
      StatsBucket: ["min", "max"],
    });
  });
});

describe("FACET_VALUES_DOCUMENT — page_size", () => {
  // `page_size: 0` is the obvious way to ask for facets and no products, and
  // the live service rejects it with an unexplained `Validation error(s)`
  // that names no argument. Isolated by bisecting against the real endpoint:
  // 1 succeeds with and without the bucket fragments, 0 fails with and
  // without them. Pinned here because the next reader will see `page_size: 1`
  // fetching a product this query discards and reasonably try to "fix" it.
  it("asks for one product, never zero", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.facetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    await getFacetValues(transport, { ...CONTEXT, attribute: "color" });

    const posted = JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string };
    expect(posted.query).toContain("page_size: 1");
    expect(posted.query).not.toContain("page_size: 0");
  });
});
