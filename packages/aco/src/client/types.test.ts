// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.1): tolerant, hand-written wire narrowing (design.md,
// Decision 4's deliberate INVERSION of the wire-gate rule — no `.strict()`
// here). Three properties, proven per keyed operation:
//   - an unrecognized extra field passes through without throwing;
//   - a missing OPTIONAL field resolves to `undefined`, not a throw;
//   - a missing KEYED field (`catalogViews[].viewId`, `priceBooks.items[].id`,
//     `policies[].policyId`/`name`) throws `AcoSchemaMismatchError` naming
//     the operation and the field path.
//
// CHANGED DELIBERATELY: the catalog-views block below was `parseListChannels-
// Result` over `channels[].channelId`/`scopes`. The admin schema renamed
// those fields (`catalog-views.ts` records what was verified live), so the
// old expectations asserted a shape the service no longer returns.
import { describe, expect, it } from "vitest";
import { AcoSchemaMismatchError } from "./errors.js";
import { parseListCatalogViewsResult, parseListPoliciesResult, parseListPriceBooksResult, parseSearchCatalogResult } from "./types.js";

describe("parseListCatalogViewsResult", () => {
  it("passes through an unrecognized extra field without throwing", () => {
    const result = parseListCatalogViewsResult({ catalogViews: [{ viewId: "acv-1", name: "View One", extraField: "unexpected" }] } as never, "ListCatalogViews");
    expect(result.views).toHaveLength(1);
  });

  it("resolves a missing OPTIONAL field (defaultPriceBookId) to undefined", () => {
    const result = parseListCatalogViewsResult({ catalogViews: [{ viewId: "acv-1", name: "View One" }] } as never, "ListCatalogViews");
    expect(result.views[0]?.defaultPriceBookId).toBeUndefined();
  });

  it("flattens sources[].locale into locales", () => {
    const result = parseListCatalogViewsResult({ catalogViews: [{ viewId: "acv-1", sources: [{ locale: "en_US" }, { locale: "fr_FR" }] }] } as never, "ListCatalogViews");
    expect(result.views[0]?.locales).toEqual(["en_US", "fr_FR"]);
  });

  /**
   * The positive control for the rename: the retired spelling must NOT be
   * silently accepted. A response still shaped like the old schema has no
   * `catalogViews` root at all, so it must parse to zero views rather than
   * quietly yielding entries keyed on a field nothing reads any more.
   */
  it("does not read the retired channels/channelId/scopes spelling", () => {
    const result = parseListCatalogViewsResult({ channels: [{ channelId: "chn-1", scopes: [{ locale: "en_US" }] }] } as never, "ListCatalogViews");
    expect(result.views).toEqual([]);
  });

  /**
   * `draft` decides what `view prune` DELETES, so it has to come off the
   * wire rather than off the view's name. A view whose name ends `_draft`
   * but whose `draft` is `false` is not a draft, and nothing downstream may
   * be able to conclude otherwise from this result.
   */
  it("carries the real `draft` field, independent of the name", () => {
    const result = parseListCatalogViewsResult(
      { catalogViews: [{ viewId: "acv-1", name: "outdoor_gear_eu_en_draft", draft: false }, { viewId: "acv-2", name: "outdoor_gear_eu_en", draft: true }] } as never,
      "ListCatalogViews",
    );
    expect(result.views.map((view) => view.draft)).toEqual([false, true]);
  });

  it("resolves an absent `draft` to undefined rather than guessing false", () => {
    const result = parseListCatalogViewsResult({ catalogViews: [{ viewId: "acv-1", name: "outdoor_gear_eu_en_draft" }] } as never, "ListCatalogViews");
    expect(result.views[0]?.draft).toBeUndefined();
  });

  it("throws AcoSchemaMismatchError naming the operation and field path when viewId is missing", () => {
    expect(() => parseListCatalogViewsResult({ catalogViews: [{ name: "View One" }] } as never, "ListCatalogViews")).toThrowError(AcoSchemaMismatchError);
    try {
      parseListCatalogViewsResult({ catalogViews: [{ name: "View One" }] } as never, "ListCatalogViews");
      expect.unreachable("expected parseListCatalogViewsResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoSchemaMismatchError);
      const mismatch = error as AcoSchemaMismatchError;
      expect(mismatch.operationName).toBe("ListCatalogViews");
      expect(mismatch.fieldPath).toBe("catalogViews[].viewId");
    }
  });
});

describe("parseListPriceBooksResult", () => {
  it("passes through an unrecognized extra field without throwing", () => {
    const result = parseListPriceBooksResult({ priceBooks: { items: [{ id: "pb-1", name: "Base", extraField: 42 }] } } as never, "ListPriceBooks");
    expect(result.items).toHaveLength(1);
  });

  it("resolves a missing OPTIONAL field (currency) to undefined", () => {
    const result = parseListPriceBooksResult({ priceBooks: { items: [{ id: "pb-1" }] } } as never, "ListPriceBooks");
    expect(result.items[0]?.currency).toBeUndefined();
  });

  it("throws AcoSchemaMismatchError naming the operation and field path when items[].id is missing", () => {
    try {
      parseListPriceBooksResult({ priceBooks: { items: [{ name: "Base" }] } } as never, "ListPriceBooks");
      expect.unreachable("expected parseListPriceBooksResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoSchemaMismatchError);
      const mismatch = error as AcoSchemaMismatchError;
      expect(mismatch.operationName).toBe("ListPriceBooks");
      expect(mismatch.fieldPath).toBe("priceBooks.items[].id");
    }
  });
});

describe("parseListPoliciesResult", () => {
  it("passes through an unrecognized extra field without throwing", () => {
    const result = parseListPoliciesResult({ policies: [{ policyId: "pol-1", name: "Discount", extraField: true }] } as never, "ListPolicies");
    expect(result.policies).toHaveLength(1);
  });

  it("resolves a missing OPTIONAL field (mandatory) to undefined", () => {
    const result = parseListPoliciesResult({ policies: [{ policyId: "pol-1", name: "Discount" }] } as never, "ListPolicies");
    expect(result.policies[0]?.mandatory).toBeUndefined();
  });

  it("throws AcoSchemaMismatchError naming the operation and field path when policyId is missing", () => {
    try {
      parseListPoliciesResult({ policies: [{ name: "Discount" }] } as never, "ListPolicies");
      expect.unreachable("expected parseListPoliciesResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoSchemaMismatchError);
      const mismatch = error as AcoSchemaMismatchError;
      expect(mismatch.operationName).toBe("ListPolicies");
      expect(mismatch.fieldPath).toBe("policies[].policyId");
    }
  });

  it("throws AcoSchemaMismatchError naming the operation and field path when name is missing", () => {
    try {
      parseListPoliciesResult({ policies: [{ policyId: "pol-1" }] } as never, "ListPolicies");
      expect.unreachable("expected parseListPoliciesResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoSchemaMismatchError);
      const mismatch = error as AcoSchemaMismatchError;
      expect(mismatch.operationName).toBe("ListPolicies");
      expect(mismatch.fieldPath).toBe("policies[].name");
    }
  });
});

/**
 * `Bucket` is an INTERFACE: its only common field is `title`. `count` lives
 * on `ScalarBucket`/`RangeBucket`/`CategoryBucket`; `StatsBucket` has
 * `min`/`max` and no `count` at all. This parser read a `value` field that
 * exists on no implementation, so every bucket narrowed to `{}`.
 */
describe("parseSearchCatalogResult — buckets are of the Bucket INTERFACE", () => {
  it("reads the interface's own `title`, which is the bucket label", () => {
    const result = parseSearchCatalogResult({ productSearch: { total_count: 1, items: [], facets: [{ attribute: "color", title: "Color", buckets: [{ title: "green", count: 3 }] }] } } as never);
    expect(result.facets[0]?.buckets?.[0]).toEqual({ title: "green", count: 3 });
  });

  it("leaves `count` ABSENT for a StatsBucket rather than defaulting it to zero", () => {
    const result = parseSearchCatalogResult({ productSearch: { total_count: 1, items: [], facets: [{ attribute: "price", buckets: [{ title: "price", min: 10, max: 90 }] }] } } as never);
    const bucket = result.facets[0]?.buckets?.[0];
    expect(bucket).not.toHaveProperty("count");
    expect(bucket?.min).toBe(10);
    expect(bucket?.max).toBe(90);
  });

  it("keeps a RangeBucket's from/to", () => {
    const result = parseSearchCatalogResult({ productSearch: { total_count: 1, items: [], facets: [{ attribute: "price", buckets: [{ title: "10-20", count: 4, from: 10, to: 20 }] }] } } as never);
    expect(result.facets[0]?.buckets?.[0]).toEqual({ title: "10-20", count: 4, from: 10, to: 20 });
  });

  /**
   * Positive control for the correction: the retired spelling must not be
   * silently accepted, or a response still shaped the old way would keep
   * these tests green while the live query returns nothing.
   */
  it("does not read the retired `value` spelling, which is on no Bucket implementation", () => {
    const result = parseSearchCatalogResult({ productSearch: { total_count: 1, items: [], facets: [{ attribute: "color", buckets: [{ value: "green", count: 3 }] }] } } as never);
    expect(result.facets[0]?.buckets?.[0]).toEqual({ count: 3 });
  });
});
