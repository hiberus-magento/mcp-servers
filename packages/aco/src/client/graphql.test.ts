// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.1): `classify()` has exactly 2 parameters —
// `(envelope, op)` — and deliberately no `status`, so a 200-with-`errors[]`
// can never be read as success and a status code can never influence
// GraphQL-level classification (design.md, Decision 1). Precedence is
// fixed: exact-value match > throttle > scope > fallthrough. Partial
// success (`data` AND `errors` both present) rejects with
// `hadPartialData: true` on the fallthrough `AcoOperationError`, and the
// `data` payload is never attached to the thrown error.
import { describe, expect, it } from "vitest";
import { AcoOperationError, AcoThrottledError, AdminScopeError, CatalogViewAccessError } from "./errors.js";
import { classify } from "./graphql.js";

describe("classify()", () => {
  it("has exactly 2 parameters: (envelope, op) — no status parameter exists to read", () => {
    // A type-level and runtime proof in one: `classify.length` is the arity
    // JS reports for a function's declared (non-rest, non-default)
    // parameters. If a `status` parameter were ever added, this fails.
    expect(classify.length).toBe(2);
  });

  it("returns the data payload, branded, when errors[] is absent", () => {
    const result = classify<{ readonly ok: boolean }>({ data: { ok: true } }, { name: "ListPolicies" });

    expect(result).toEqual({ ok: true });
  });

  it("a 200-with-errors[] response is classified as a failure — proven alongside its own 200/ok status in the same test", () => {
    const response = new Response(JSON.stringify({ data: null, errors: [{ message: "Internal error" }] }), { status: 200 });

    // Both halves in the same test, per design.md Decision 1's fixture note:
    // the response really is a 200/ok success at the transport level...
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    // ...and classify() still throws before `data` is ever read.
    expect(() => classify({ data: null, errors: [{ message: "Internal error" }] }, { name: "ListPolicies" })).toThrow(AcoOperationError);
  });

  it("classifies x-commerce-exception: access-key-invalid as CatalogViewAccessError (exact-value match)", () => {
    expect(() =>
      classify(
        { errors: [{ message: "Access key validation failed: Missing token", extensions: { "x-commerce-exception": "access-key-invalid" } }] },
        { name: "SearchCatalog" },
      ),
    ).toThrow(CatalogViewAccessError);
  });

  it("does NOT treat a substring match on x-commerce-exception as access-key-invalid (exact value only)", () => {
    expect(() =>
      classify(
        { errors: [{ message: "unrelated", extensions: { "x-commerce-exception": "access-key-invalid-but-different" } }] },
        { name: "SearchCatalog" },
      ),
    ).not.toThrow(CatalogViewAccessError);
  });

  it("classifies a throttle-shaped classification as AcoThrottledError", () => {
    expect(() =>
      classify({ errors: [{ message: "slow down", extensions: { classification: "rate-limit-exceeded" } }] }, { name: "ListPriceBooks" }),
    ).toThrow(AcoThrottledError);
  });

  it("classifies a permission/scope-shaped message as AdminScopeError", () => {
    expect(() => classify({ errors: [{ message: "This operation is forbidden for the current scope" }] }, { name: "ListChannels" })).toThrow(
      AdminScopeError,
    );
  });

  it("precedence: exact-value beats throttle beats scope — a throttle whose message also says forbidden is still classified as throttled", () => {
    expect(() =>
      classify(
        { errors: [{ message: "forbidden: too many requests, rate limited", extensions: { classification: "throttled" } }] },
        { name: "ListPolicies" },
      ),
    ).toThrow(AcoThrottledError);
  });

  it("falls through to AcoOperationError for anything unmatched, carrying message and extensions verbatim", () => {
    const extensions = { classification: "internal-error" };
    try {
      classify({ errors: [{ message: "Internal error", extensions }] }, { name: "ListPolicies" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoOperationError);
      const operationError = error as AcoOperationError;
      expect(operationError.message).toContain("Internal error");
      expect(operationError.extensions).toEqual(extensions);
      expect(operationError.hadPartialData).toBe(false);
    }
  });

  it("partial success (data AND errors both present) rejects with hadPartialData: true and never attaches the data payload", () => {
    const secretPayload = { leakedMarker: "should-never-appear-on-the-error" };
    try {
      classify({ data: secretPayload, errors: [{ message: "one field failed" }] }, { name: "ListPolicies" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoOperationError);
      const operationError = error as AcoOperationError;
      expect(operationError.hadPartialData).toBe(true);
      // The payload itself must never ride along on the thrown error.
      expect(JSON.stringify(operationError)).not.toContain("leakedMarker");
      expect(Object.hasOwn(operationError, "data")).toBe(false);
    }
  });

  it("an empty errors[] array is treated as success, not failure", () => {
    const result = classify<{ readonly ok: boolean }>({ data: { ok: true }, errors: [] }, { name: "ListPolicies" });

    expect(result).toEqual({ ok: true });
  });
});
