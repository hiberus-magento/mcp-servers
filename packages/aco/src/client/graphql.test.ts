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
    expect(() => classify({ errors: [{ message: "This operation is forbidden for the current scope" }] }, { name: "ListCatalogViews" })).toThrow(
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

/**
 * RED-first. A GraphQL response may carry MANY `errors[]` entries, and
 * `classify()` used to keep only `errors[0]`. Against the live service that
 * reduced a multi-error validation failure to
 * `ACO GraphQL operation "SearchCatalog" failed: Validation error(s)` — the
 * one entry that names nothing — while the entries naming the offending
 * ARGUMENT were discarded. Diagnosing it cost a bisection; the server had
 * said which argument all along.
 *
 * The messages below are written to that failure's shape (a rejected
 * `page_size`); they are not copied from a tenant response.
 */
describe("classify() — every message in errors[] survives, not just the first", () => {
  const MULTI_ERROR = [
    { message: "Validation error(s)" },
    { message: "Validation error (WrongType@[productSearch]) : argument 'page_size' with value 'IntValue{value=0}' is not a valid 'Int'" },
    { message: "Validation error (WrongType@[productSearch]) : argument 'page_size' must be greater than 0" },
  ] as const;

  it("names every message in the rendered error, including the ones after the first", () => {
    try {
      classify({ data: null, errors: MULTI_ERROR }, { name: "SearchCatalog" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AcoOperationError);
      for (const entry of MULTI_ERROR) {
        expect((error as AcoOperationError).message).toContain(entry.message);
      }
    }
  });

  it("carries every message as data on the error, in wire order", () => {
    try {
      classify({ data: null, errors: MULTI_ERROR }, { name: "SearchCatalog" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect((error as AcoOperationError).messages).toEqual(MULTI_ERROR.map((entry) => entry.message));
    }
  });

  it("surfaces the other messages alongside a CLASSIFIED entry too — a scope failure reported with two others keeps all three", () => {
    try {
      classify(
        { errors: [{ message: "field `foo` is not defined" }, { message: "This operation is forbidden for the current scope" }, { message: "field `bar` is not defined" }] },
        { name: "ListCatalogViews" },
      );
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminScopeError);
      const scopeError = error as AdminScopeError;
      // The classified entry leads — it is the one that chose this class and
      // its remedy — and the rest follow in wire order.
      expect(scopeError.messages[0]).toBe("This operation is forbidden for the current scope");
      expect([...scopeError.messages].sort()).toEqual([
        "This operation is forbidden for the current scope",
        "field `bar` is not defined",
        "field `foo` is not defined",
      ]);
      expect(scopeError.message).toContain("field `bar` is not defined");
    }
  });

  /**
   * Bounded, because an error message ends up in logs: the rendered string
   * carries the first few and says how many it dropped, while `messages`
   * keeps every one for a caller that wants them all.
   */
  it("bounds the rendered message and says how many it left out, without dropping them from `messages`", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ message: `rejected argument number ${index}` }));
    try {
      classify({ errors: many }, { name: "SearchCatalog" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      const operationError = error as AcoOperationError;
      expect(operationError.messages).toHaveLength(9);
      expect(operationError.message).toContain("rejected argument number 0");
      expect(operationError.message).not.toContain("rejected argument number 8");
      expect(operationError.message).toContain("(+4 more)");
    }
  });

  it("truncates a single enormous message rather than putting the whole thing in a log line", () => {
    const huge = "x".repeat(5000);
    try {
      classify({ errors: [{ message: huge }] }, { name: "SearchCatalog" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect((error as AcoOperationError).message.length).toBeLessThan(600);
    }
  });

  it("an errors[] entry with no message at all does not become an empty slot", () => {
    try {
      classify({ errors: [{ extensions: { classification: "internal-error" } }, { message: "the real reason" }] }, { name: "ListPolicies" });
      expect.unreachable("classify() should have thrown");
    } catch (error) {
      expect((error as AcoOperationError).messages).toEqual(["the real reason"]);
    }
  });
});
