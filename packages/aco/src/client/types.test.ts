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
import { parseListCatalogViewsResult, parseListPoliciesResult, parseListPriceBooksResult } from "./types.js";

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
