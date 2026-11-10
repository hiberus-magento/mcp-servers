// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The guard is what lets the generic `query` tool exist at all: it must call
// a mutation a mutation however the document is dressed (comments, strings, fragments,
// several operations), and must refuse what it cannot read to the end.
import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_CHARS, MAX_SELECTION_DEPTH, OperationGuardError, inspectDocument } from "./operation-guard.js";

describe("inspectDocument", () => {
  it("reads an anonymous shorthand query", () => {
    expect(inspectDocument("{ storeConfig { store_code } }")).toMatchObject({ kind: "query", operations: 1, depth: 2 });
  });

  it("reads a named query with variables and a fragment", () => {
    const doc = `query Products($s: String!) { products(search: $s) { items { ...F } } } fragment F on ProductInterface { sku name }`;
    expect(inspectDocument(doc)).toMatchObject({ kind: "query", name: "Products", operations: 1 });
  });

  it("reads a mutation", () => {
    expect(inspectDocument("mutation { createEmptyCart }")).toMatchObject({ kind: "mutation", operations: 1 });
  });

  it("reads a subscription", () => {
    expect(inspectDocument("subscription { x }").kind).toBe("subscription");
  });

  it("is not fooled by the word mutation inside a comment, a string or a block string", () => {
    const doc = `# mutation { evil }\nquery { a(x: "mutation { b }") { c(y: """mutation {""") } }`;
    expect(inspectDocument(doc)).toMatchObject({ kind: "query", operations: 1 });
  });

  it("is not fooled by an escaped quote inside a string", () => {
    expect(inspectDocument('query { a(x: "he said \\" mutation {") { b } }').kind).toBe("query");
  });

  it("counts several operations so a caller can refuse them", () => {
    expect(inspectDocument("query A { a } mutation B { b }")).toMatchObject({ operations: 2 });
  });

  it("reports the mutation when a query and a mutation share a document", () => {
    expect(inspectDocument("query A { a } mutation B { b }").kind).toBe("mutation");
  });

  it("measures selection depth, ignoring arguments", () => {
    expect(inspectDocument("{ a { b { c { d } } } }").depth).toBe(4);
    expect(inspectDocument('{ a(filter: { x: { y: 1 } }) { b } }').depth).toBe(2);
  });

  it.each([
    ["", "empty"],
    ["   # only a comment", "empty"],
    ["query { a ", "unbalanced"],
    ["query { a } }", "unbalanced"],
    ['query { a(x: "open) { b } }', "unterminated string"],
    ["query { a(x: 1 { b } }", "unbalanced"],
    ["fragment F on T { a }", "no operation"],
  ])("refuses %j (%s)", (doc) => {
    expect(() => inspectDocument(doc)).toThrow(OperationGuardError);
  });

  it(`refuses a document longer than ${MAX_DOCUMENT_CHARS} characters`, () => {
    expect(() => inspectDocument(`{ ${"a ".repeat(MAX_DOCUMENT_CHARS)} }`)).toThrow(/characters/);
  });

  it(`refuses selection deeper than ${MAX_SELECTION_DEPTH}`, () => {
    const deep = `${"{ a ".repeat(MAX_SELECTION_DEPTH + 1)}${"}".repeat(MAX_SELECTION_DEPTH + 1)}`;
    expect(() => inspectDocument(deep)).toThrow(/depth/);
  });

  it("refuses a document that is not a string", () => {
    expect(() => inspectDocument(undefined as unknown as string)).toThrow(OperationGuardError);
  });
});
