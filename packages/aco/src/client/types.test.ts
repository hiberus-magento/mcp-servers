// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.1): tolerant, hand-written wire narrowing (design.md,
// Decision 4's deliberate INVERSION of the wire-gate rule — no `.strict()`
// here). Three properties, proven per keyed operation:
//   - an unrecognized extra field passes through without throwing;
//   - a missing OPTIONAL field resolves to `undefined`, not a throw;
//   - a missing KEYED field (`channels[].channelId`, `priceBooks.items[].id`,
//     `policies[].policyId`/`name`) throws `AcoSchemaMismatchError` naming
//     the operation and the field path.
import { describe, expect, it } from "vitest";
import { AcoSchemaMismatchError } from "./errors.js";
import { parseListChannelsResult, parseListPoliciesResult, parseListPriceBooksResult } from "./types.js";

describe("parseListChannelsResult", () => {
  it("passes through an unrecognized extra field without throwing", () => {
    const result = parseListChannelsResult({ channels: [{ channelId: "chn-1", name: "View One", extraField: "unexpected" }] } as never, "ListChannels");
    expect(result.views).toHaveLength(1);
  });

  it("resolves a missing OPTIONAL field (defaultPriceBookId) to undefined", () => {
    const result = parseListChannelsResult({ channels: [{ channelId: "chn-1", name: "View One" }] } as never, "ListChannels");
    expect(result.views[0]?.defaultPriceBookId).toBeUndefined();
  });

  it("throws AcoSchemaMismatchError naming the operation and field path when channelId is missing", () => {
    expect(() => parseListChannelsResult({ channels: [{ name: "View One" }] } as never, "ListChannels")).toThrowError(AcoSchemaMismatchError);
    try {
      parseListChannelsResult({ channels: [{ name: "View One" }] } as never, "ListChannels");
      expect.unreachable("expected parseListChannelsResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoSchemaMismatchError);
      const mismatch = error as AcoSchemaMismatchError;
      expect(mismatch.operationName).toBe("ListChannels");
      expect(mismatch.fieldPath).toBe("channels[].channelId");
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
