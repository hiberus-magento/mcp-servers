// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The trimmer adapts a FIXED document of this package to the connected store's schema (design D14):
// it removes what the store lacks and nothing else, and refuses a document it cannot read rather than sending
// one half-trimmed.
import { describe, expect, it } from "vitest";
import { introspectionOf } from "../testing/schema-double.js";
import { DocumentReadError, readDocument, removeFieldsNamed, trimDocument } from "./document.js";
import { inspectDocument } from "./operation-guard.js";
import { readStoreSchema, type StoreSchema } from "./schema.js";

const schemaOf = (compact: Parameters<typeof introspectionOf>[0]): StoreSchema => {
  const schema = readStoreSchema(introspectionOf(compact));
  if (schema === undefined) throw new Error("unreadable test schema");
  return schema;
};

const STORE = schemaOf({
  Query: { cart: "Cart(cart_id)", products: "Products(search,filter)" },
  Mutation: { updateCartItems: "CartOutput(input)" },
  CartOutput: { cart: "Cart" },
  Cart: { id: "String", total_quantity: "Float", prices: "CartPrices", items: "CartItem" },
  CartPrices: { grand_total: "Money" },
  CartItem: { uid: "ID", quantity: "Float" },
  Money: { value: "Float", currency: "String" },
  Products: { total_count: "Int", items: "ProductInterface" },
  ProductInterface: { __possibleTypes: "SimpleProduct,ConfigurableProduct", sku: "String", name: "String" },
  SimpleProduct: { sku: "String", name: "String" },
  ConfigurableProduct: { sku: "String", name: "String", variants: "Variant" },
  Variant: { label: "String" },
});

const trimmed = (document: string, schema: StoreSchema = STORE) => {
  const outcome = trimDocument(document, schema);
  if (outcome.status !== "trimmed") throw new Error(`expected trimmed, got ${outcome.status}`);
  return outcome;
};

describe("trimDocument", () => {
  it("removes a field the store's type lacks", () => {
    const out = trimmed("query GetCart($id: String!) { cart(cart_id: $id) { id is_virtual total_quantity } }");
    expect(out.document).toBe("query GetCart($id: String!) { cart(cart_id: $id) { id total_quantity } }");
    expect(out.removed).toEqual(["Cart.is_virtual"]);
  });

  it("removes an argument the store's field lacks", () => {
    const out = trimmed("query P($s: String, $p: Int) { products(search: $s, pageSize: $p) { total_count } }");
    expect(out.document).toBe("query P($s: String) { products(search: $s) { total_count } }");
  });

  it("removes a field whose selection set is left empty, up the tree", () => {
    const out = trimmed("query C($id: String!) { cart(cart_id: $id) { id prices { discounts { label } subtotal { value } } } }");
    expect(out.document).toBe("query C($id: String!) { cart(cart_id: $id) { id } }");
    expect(out.removed).toEqual(["CartPrices.discounts", "CartPrices.subtotal", "Cart.prices"]);
  });

  it("removes a variable no longer used, and names it so the caller drops it from the variables", () => {
    const out = trimmed("query P($s: String, $p: Int, $c: Int) { products(search: $s, pageSize: $p, currentPage: $c) { total_count } }");
    expect(out.document).toBe("query P($s: String) { products(search: $s) { total_count } }");
    expect(out.droppedVariables).toEqual(["p", "c"]);
  });

  it("produces a document the operation guard still accepts", () => {
    const out = trimmed("mutation U($id: String!, $items: [CartItemUpdateInput!]!) { updateCartItems(input: { cart_id: $id, cart_items: $items }) { cart { id is_virtual } } }");
    expect(out.document).toBe("mutation U($id: String!, $items: [CartItemUpdateInput!]!) { updateCartItems(input: { cart_id: $id, cart_items: $items }) { cart { id } } }");
    expect(inspectDocument(out.document)).toMatchObject({ kind: "mutation", operations: 1, name: "U" });
  });

  it("keeps a variable used only by a directive, inline fragments of known types, and __typename", () => {
    const document = "query P($s: String, $agg: Boolean!) { products(search: $s) { total_count @include(if: $agg) items { __typename sku ... on ConfigurableProduct { variants { label } } } } }";
    expect(trimDocument(document, STORE)).toEqual({ status: "unchanged" });
  });

  it("removes an inline fragment on a type the store does not have", () => {
    const out = trimmed("query P($s: String) { products(search: $s) { items { sku ... on BundleProduct { items { title } } } } }");
    expect(out.document).toBe("query P($s: String) { products(search: $s) { items { sku } } }");
  });

  it("leaves a document that fits the schema unchanged, text included", () => {
    expect(trimDocument("query GetCart($id: String!) {\n  cart(cart_id: $id) { id }\n}", STORE)).toEqual({ status: "unchanged" });
  });

  it("reports a root operation the store does not offer, without trimming", () => {
    expect(trimDocument("query Q { company { id } }", STORE)).toEqual({ status: "missing-operation", operation: "company" });
    expect(trimDocument("mutation M { createCompany(input: {}) { company { id } } }", STORE)).toEqual({ status: "missing-operation", operation: "createCompany" });
  });

  it("reports an operation of which the store has none of the selected fields", () => {
    expect(trimDocument("query C($id: String!) { cart(cart_id: $id) { gift_message { from } } }", STORE)).toEqual({ status: "nothing-left", operation: "cart" });
  });

  it("does not touch introspection fields", () => {
    expect(trimDocument("query L { __schema { queryType { fields { name } } } }", STORE)).toEqual({ status: "unchanged" });
  });
});

describe("removeFieldsNamed (fallback without a schema)", () => {
  it("removes every selection of the named field, the selections it empties and the variables it frees", () => {
    const out = removeFieldsNamed("query C($id: String!, $p: Int) { cart(cart_id: $id) { id prices { discounts(page: $p) { label } } } }", new Set(["discounts"]));
    expect(out).toEqual({ document: "query C($id: String!) { cart(cart_id: $id) { id } }", droppedVariables: ["p"] });
  });

  it("never removes the root field, and answers undefined when nothing was removed", () => {
    expect(removeFieldsNamed("query C($id: String!) { cart(cart_id: $id) { id } }", new Set(["cart"]))).toBeUndefined();
    expect(removeFieldsNamed("query C($id: String!) { cart(cart_id: $id) { id } }", new Set(["nope"]))).toBeUndefined();
  });

  it("answers undefined when removing the field would empty the operation", () => {
    expect(removeFieldsNamed("query C($id: String!) { cart(cart_id: $id) { id } }", new Set(["id"]))).toBeUndefined();
  });
});

describe("readDocument refuses what it cannot read, instead of half-trimming it", () => {
  it.each([
    ["an alias", "query Q { c: cart(cart_id: \"x\") { id } }"],
    ["a fragment spread", "query Q { cart(cart_id: \"x\") { ...CartFields } }"],
    ["a fragment definition", "query Q { cart(cart_id: \"x\") { id } } fragment F on Cart { id }"],
    ["two operations", "query A { a } query B { b }"],
    ["a subscription", "subscription S { x }"],
    ["unbalanced braces", "query Q { cart(cart_id: \"x\") { id }"],
    ["an unterminated string", "query Q { cart(cart_id: \"x) { id } }"],
  ])("%s", (_label, document) => {
    expect(() => readDocument(document)).toThrow(DocumentReadError);
  });

  it("reads literals of every kind in arguments: strings, numbers, enums, lists and objects", () => {
    const document = 'query Q($f: String) { products(search: "tent \\"x\\"", filter: { sku: { in: ["A", "B"] }, price: { from: -1.5e2 }, name: $f }, sort: { name: ASC }, pageSize: 1) { total_count } }';
    expect(readDocument(document).selections).toHaveLength(1);
    const out = trimmed(document);
    expect(out.document).toBe('query Q($f: String) { products(search: "tent \\"x\\"", filter: { sku: { in: ["A", "B"] }, price: { from: -1.5e2 }, name: $f }) { total_count } }');
  });
});
