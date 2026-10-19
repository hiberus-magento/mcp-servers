// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.20): every GraphQL document under
// `client/operations/` MUST be a NAMED operation, never anonymous
// (design.md, Decision 5) — the fetch double keys routes on the operation
// name extracted from the posted document, so an anonymous document is not
// keyable at all, and named operations also make `AcoSchemaMismatchError`
// and every log line nameable.
//
// The checker function itself is proven against synthetic fixtures (a real
// RED/GREEN cycle): a named query, a named mutation, an anonymous
// `query { }`, and the bare `{ }` shorthand.
//
// CHANGED DELIBERATELY: the directory scan below used to find its documents
// with its own `document:\s*`...`` regex, written in Phase 1 against a
// directory that did not exist yet. Every operation module Phase 2 actually
// shipped hoists its document into a `const <NAME>_DOCUMENT` instead, so
// that regex matched NOTHING and this scan passed vacuously for the whole
// life of the package. It now shares the collector in
// `testing/operation-documents.ts` with `operations/document-validity.test.ts`,
// and asserts the scan found something — a guard that can silently find
// nothing is the same defect class it exists to catch.
import { describe, expect, it } from "vitest";
import { collectOperationDocuments, operationModuleNames } from "../testing/operation-documents.js";

const NAMED_OPERATION_PATTERN = /^\s*(?:query|mutation|subscription)\s+[A-Za-z_]\w*/;

function isNamedOperationDocument(document: string): boolean {
  return NAMED_OPERATION_PATTERN.test(document);
}

describe("isNamedOperationDocument (proven against synthetic fixtures)", () => {
  it("accepts a named query", () => {
    expect(isNamedOperationDocument("query ListPolicies { policies { policyId } }")).toBe(true);
  });

  it("accepts a named mutation", () => {
    expect(isNamedOperationDocument("mutation UpdatePolicy($id: ID!) { updatePolicy(id: $id) { policyId } }")).toBe(true);
  });

  it("rejects an anonymous query — the Python CLI's own shape, deliberately not reused", () => {
    expect(isNamedOperationDocument("query { policies { policyId } }")).toBe(false);
  });

  it("rejects the bare shorthand form with no operation keyword at all", () => {
    expect(isNamedOperationDocument("{ policies { policyId } }")).toBe(false);
  });
});

describe("client/operations/ — every document is named (real scan)", () => {
  const documents = collectOperationDocuments();

  it("is actually scanning documents — every operation module contributes one", () => {
    expect(documents.length).toBeGreaterThan(0);
    expect([...new Set(documents.map((entry) => entry.file))].sort()).toEqual(operationModuleNames());
  });

  it("contains no anonymous GraphQL document", () => {
    const violations = documents.filter((entry) => !isNamedOperationDocument(entry.document)).map((entry) => `${entry.file} ${entry.constName}: anonymous document "${entry.document.slice(0, 40)}"`);
    expect(violations).toEqual([]);
  });
});
