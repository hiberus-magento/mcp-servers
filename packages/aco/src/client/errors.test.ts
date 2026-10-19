// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.3): every `AcoError` subclass declares
// `kind`/`remedy`/`signalledBy`/`confidence` (design.md, Decision 1).
// `AdminScopeError`'s remedy names BOTH exits, and `confidence: "heuristic"`
// is asserted as a readable runtime field — not merely a source comment —
// on both heuristic classes.
import { describe, expect, it } from "vitest";
import {
  AcoError,
  AcoOperationError,
  AcoSchemaMismatchError,
  AcoThrottledError,
  AcoTransportError,
  AdminScopeError,
  CatalogViewAccessError,
} from "./errors.js";

describe("AcoError hierarchy", () => {
  it("CatalogViewAccessError declares kind/remedy/signalledBy/confidence and extends AcoError", () => {
    const error = new CatalogViewAccessError({ operationName: "SearchCatalog", message: "Access key validation failed: Missing token" });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("catalog-view-access");
    expect(error.signalledBy).toBe("graphql-errors");
    expect(error.confidence).toBe("documented-extension");
    expect(typeof error.remedy).toBe("string");
    expect(error.remedy.length).toBeGreaterThan(0);
  });

  it("AdminScopeError's remedy names BOTH exits: re-mint and paste", () => {
    const error = new AdminScopeError({ operationName: "ListCatalogViews", message: "forbidden" });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("admin-scope");
    expect(error.signalledBy).toBe("graphql-errors");
    expect(error.remedy).toContain("hiberus-aco auth mint");
    expect(error.remedy).toContain("hiberus-aco auth token set");
  });

  it("AdminScopeError.confidence is the runtime string \"heuristic\", not just a comment", () => {
    const error = new AdminScopeError({ operationName: "ListCatalogViews", message: "forbidden" });

    // A real runtime field: readable by a caller at runtime, not just documentation.
    expect(error.confidence).toBe("heuristic");
    expect(error.remedy.toLowerCase()).toContain("heuristic");
  });

  it("AcoThrottledError.confidence is the runtime string \"heuristic\"", () => {
    const error = new AcoThrottledError({ operationName: "ListPriceBooks", message: "too many requests" });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("throttled");
    expect(error.confidence).toBe("heuristic");
    expect(error.remedy.toLowerCase()).toContain("heuristic");
  });

  it("AcoOperationError carries the verbatim message and extensions, and confidence is certain", () => {
    const extensions = { classification: "internal-error" };
    const error = new AcoOperationError({ operationName: "ListPolicies", message: "Internal server error", extensions, hadPartialData: false });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("operation");
    expect(error.confidence).toBe("certain");
    expect(error.extensions).toEqual(extensions);
    expect(error.message).toContain("Internal server error");
    expect(error.hadPartialData).toBe(false);
  });

  it("AcoOperationError.hadPartialData true renders a different remedy than false, and never attaches a data payload field", () => {
    const partial = new AcoOperationError({ operationName: "ListPolicies", message: "failed", hadPartialData: true });
    const total = new AcoOperationError({ operationName: "ListPolicies", message: "failed", hadPartialData: false });

    expect(partial.hadPartialData).toBe(true);
    expect(partial.remedy).not.toBe(total.remedy);
    expect(Object.hasOwn(partial, "data")).toBe(false);
  });

  it("AcoTransportError is signalledBy transport, confidence certain, and carries its reason", () => {
    const error = new AcoTransportError({ reason: "no-graphql-envelope", status: 429 });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("transport");
    expect(error.signalledBy).toBe("transport");
    expect(error.confidence).toBe("certain");
    expect(error.reason).toBe("no-graphql-envelope");
    expect(error.status).toBe(429);
  });

  it("AcoSchemaMismatchError names the operation and the field path in its remedy", () => {
    const error = new AcoSchemaMismatchError({ operationName: "ListCatalogViews", fieldPath: "catalogViews[].viewId" });

    expect(error).toBeInstanceOf(AcoError);
    expect(error.kind).toBe("schema-mismatch");
    expect(error.signalledBy).toBe("client");
    expect(error.confidence).toBe("certain");
    expect(error.remedy).toContain("ListCatalogViews");
    expect(error.remedy).toContain("catalogViews[].viewId");
  });
});
