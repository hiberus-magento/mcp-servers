// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.20): every GraphQL document under
// `client/operations/` MUST be a NAMED operation, never anonymous
// (design.md, Decision 5) — the fetch double keys routes on the operation
// name extracted from the posted document, so an anonymous document is not
// keyable at all, and named operations also make `AcoSchemaMismatchError`
// and every log line nameable.
//
// `client/operations/` does not exist yet — it is Phase 2's deliverable.
// The checker function itself is proven here, now, against synthetic
// fixtures (a real RED/GREEN cycle, not deferred): a named query, a named
// mutation, an anonymous `query { }`, and the bare `{ }` shorthand. The
// directory-level scan below is written to run against the real tree the
// moment it exists; until then it holds vacuously (there is nothing to
// violate), and Phase 2 is expected to keep it passing for real once
// `operations/*.ts` documents land.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const OPERATIONS_DIR = fileURLToPath(new URL("./operations/", import.meta.url));

const NAMED_OPERATION_PATTERN = /^\s*(?:query|mutation|subscription)\s+[A-Za-z_]\w*/;

function isNamedOperationDocument(document: string): boolean {
  return NAMED_OPERATION_PATTERN.test(document);
}

function extractDocumentLiterals(source: string): string[] {
  // Matches a template literal assigned as the value of a `document:` field
  // — the shape every `client/operations/*.ts` module uses (design.md,
  // Decision 5's `GraphQlOperation.document`).
  const matches = [...source.matchAll(/document:\s*`([^`]*)`/g)];
  return matches.map((match) => match[1] ?? "");
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

describe("client/operations/ — every document is named (real scan, once Phase 2 populates the directory)", () => {
  it("contains no anonymous GraphQL document", () => {
    if (!existsSync(OPERATIONS_DIR)) {
      // Phase 2 has not landed yet — vacuously true: there is nothing under
      // client/operations/ to violate the rule.
      expect(true).toBe(true);
      return;
    }
    const violations: string[] = [];
    for (const entry of readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }
      const source = readFileSync(`${OPERATIONS_DIR}${entry.name}`, "utf8");
      for (const document of extractDocumentLiterals(source)) {
        if (!isNamedOperationDocument(document)) {
          violations.push(`${entry.name}: anonymous document "${document.slice(0, 40)}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
