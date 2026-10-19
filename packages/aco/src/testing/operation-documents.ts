// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Collects every GraphQL document this package ships, by reading the
// `client/operations/*.ts` sources. Test-only infrastructure, so it lives
// beside `fetch-double.ts` rather than under `client/` (the client-purity
// scan and the client-boundary eslint rule both operate on `client/**`).
//
// Why read the source text rather than import the modules: the documents
// are module-private `const`s, deliberately — nothing outside an operation
// module should be able to reach its document at runtime. A source scan is
// the only way to assert anything about ALL of them at once, and asserting
// about the document text is the point: the fetch double routes on the
// operation NAME extracted from the posted body and never looks at the rest
// of the document, so a document that no conformant GraphQL server would
// accept still passes every response-shaped test (that is exactly how the
// `SearchCatalog` nullability bug and the `FacetValues` unused-variable bug
// both shipped). Every consumer of this collector MUST assert the collected
// set is non-empty — a silently-empty scan is a guard that proves nothing.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Kind, parse, visit, type FieldNode } from "graphql";

export const OPERATIONS_DIR = fileURLToPath(new URL("../client/operations/", import.meta.url));

export interface CollectedDocument {
  /** File name within `client/operations/`, e.g. `"policies.ts"`. */
  readonly file: string;
  /** The declaring `const` name, or `"<inline>"` for a document written inline at the `document:` field. */
  readonly constName: string;
  /** The GraphQL document text, exactly as posted. */
  readonly document: string;
}

// Both shapes are matched on purpose. Every current operation module hoists
// its document into a `const <NAME>_DOCUMENT`, and matching ONLY the
// `document:` field (as the first version of this scan did) found zero
// documents and passed vacuously for the whole life of the package.
const DOCUMENT_CONST_PATTERN = /const\s+(\w*DOCUMENT)\s*=\s*`([^`]*)`/g;
const INLINE_DOCUMENT_PATTERN = /document:\s*`([^`]*)`/g;

export function extractDocuments(source: string, file: string): CollectedDocument[] {
  const collected: CollectedDocument[] = [];
  for (const match of source.matchAll(DOCUMENT_CONST_PATTERN)) {
    collected.push({ file, constName: match[1] ?? "", document: match[2] ?? "" });
  }
  for (const match of source.matchAll(INLINE_DOCUMENT_PATTERN)) {
    collected.push({ file, constName: "<inline>", document: match[1] ?? "" });
  }
  return collected;
}

/** Every `.ts` module under `client/operations/`, test files excluded. */
export function operationModuleNames(): string[] {
  return readdirSync(OPERATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test-d.ts"))
    .map((entry) => entry.name)
    .sort();
}

/** Every GraphQL document shipped under `client/operations/`. */
export function collectOperationDocuments(): CollectedDocument[] {
  return operationModuleNames().flatMap((name) => extractDocuments(readFileSync(`${OPERATIONS_DIR}${name}`, "utf8"), name));
}

export interface FieldSelection {
  /** Field names selected directly on the field itself. */
  readonly fields: readonly string[];
  /** Field names selected inside each inline fragment, keyed by its type condition. */
  readonly fragmentFields: Record<string, readonly string[]>;
}

/**
 * The selection set of the FIRST occurrence of `fieldName` in `document`,
 * split into plain fields and per-type inline fragments.
 *
 * Needed because the schema-free validity scan cannot see types: it cannot
 * know that `Bucket` is an interface, that `ScalarBucket` implements it, or
 * that `value` is a field no implementation has. Only an assertion written
 * against the verified schema can, which is why the two `productSearch`
 * operation tests pin their `buckets` selection with this.
 */
export function selectionOf(document: string, fieldName: string): FieldSelection {
  const fields: string[] = [];
  const fragmentFields: Record<string, readonly string[]> = {};
  let found = false;
  visit(parse(document), {
    Field: (node) => {
      if (found || node.name.value !== fieldName) {
        return;
      }
      found = true;
      for (const selection of node.selectionSet?.selections ?? []) {
        if (selection.kind === Kind.FIELD) {
          fields.push(selection.name.value);
        }
        if (selection.kind === Kind.INLINE_FRAGMENT && selection.typeCondition !== undefined) {
          fragmentFields[selection.typeCondition.name.value] = selection.selectionSet.selections.filter((inner): inner is FieldNode => inner.kind === Kind.FIELD).map((inner) => inner.name.value);
        }
      }
    },
  });
  return { fields, fragmentFields };
}
