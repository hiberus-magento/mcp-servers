// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { data } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { cartTools } from "./cart-tools.js";
import { customerTools } from "./customer-tools.js";
import { queryTools } from "./query-tools.js";

const CART = "AbC123xyz";

describe("customerTools", () => {
  it("exposes three read tools", () => {
    const { tools } = buildToolHarness(customerTools, data({}));
    expect(tools.map((t) => t.name).sort()).toEqual(["magentographql_get_customer", "magentographql_get_customer_cart", "magentographql_get_customer_orders"]);
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });

  it("every description says the token is needed", () => {
    for (const tool of buildToolHarness(customerTools, data({})).tools) expect(tool.description).toMatch(/customer token/i);
  });

  it("reads the customer, the cart and the orders", async () => {
    expect(await buildToolHarness(customerTools, data({ customer: { firstname: "A" } })).call("magentographql_get_customer", {})).toEqual({ firstname: "A" });
    expect(await buildToolHarness(customerTools, data({ customerCart: { id: CART } })).call("magentographql_get_customer_cart", {})).toEqual({ id: CART });
    const h = buildToolHarness(customerTools, data({ customer: { orders: { total_count: 0, items: [] } } }));
    expect(await h.call("magentographql_get_customer_orders", { order_number: "DEMO000000001", page_size: 5 })).toEqual({ total_count: 0, items: [] });
    expect(h.lastVariables()).toEqual({ filter: { number: { eq: "DEMO000000001" } }, pageSize: 5, currentPage: 1 });
  });

  it("reads orders without a filter by default", async () => {
    const h = buildToolHarness(customerTools, data({ customer: { orders: { items: [] } } }));
    await h.call("magentographql_get_customer_orders", {});
    expect(h.lastVariables()).toEqual({ pageSize: 10, currentPage: 1 });
  });

  it("does not select street, phone, birth date or tax id", () => {
    for (const tool of buildToolHarness(customerTools, data({})).tools) expect(tool.document).not.toMatch(/street|telephone|date_of_birth|taxvat|gender/);
  });
});

describe("cartTools", () => {
  const names = [
    "magentographql_add_products_to_cart",
    "magentographql_apply_coupon",
    "magentographql_get_cart",
    "magentographql_remove_cart_item",
    "magentographql_remove_coupon",
    "magentographql_update_cart_items",
  ];

  it("exposes one read and five writes", () => {
    const { tools } = buildToolHarness(cartTools, data({}));
    expect(tools.map((t) => t.name).sort()).toEqual(names);
    expect(tools.filter((t) => t.access === "read").map((t) => t.name)).toEqual(["magentographql_get_cart"]);
  });

  it("reads a cart by its masked id", async () => {
    const h = buildToolHarness(cartTools, data({ cart: { id: CART, total_quantity: 2 } }));
    expect(await h.call("magentographql_get_cart", { cart_id: CART })).toEqual({ id: CART, total_quantity: 2 });
    expect(h.lastVariables()).toEqual({ cartId: CART });
  });

  it("adds products with sku and quantity as variables and reports user errors", async () => {
    const result = { cart: { id: CART }, user_errors: [{ code: "INSUFFICIENT_STOCK", message: "Not enough" }] };
    const h = buildToolHarness(cartTools, data({ addProductsToCart: result }));
    expect(await h.call("magentographql_add_products_to_cart", { cart_id: CART, items: [{ sku: "DEMO-TENT-001", quantity: 2 }] })).toEqual(result);
    expect(h.lastVariables()).toEqual({ cartId: CART, items: [{ sku: "DEMO-TENT-001", quantity: 2 }] });
  });

  it("updates quantities, removes an item, applies and removes a coupon", async () => {
    const h = buildToolHarness(cartTools, data({ updateCartItems: { cart: { id: CART } }, removeItemFromCart: { cart: { id: CART } }, applyCouponToCart: { cart: { id: CART } }, removeCouponFromCart: { cart: { id: CART } } }));
    await h.call("magentographql_update_cart_items", { cart_id: CART, items: [{ cart_item_uid: "Mw==", quantity: 3 }] });
    expect(h.lastVariables()).toEqual({ cartId: CART, items: [{ cart_item_uid: "Mw==", quantity: 3 }] });
    await h.call("magentographql_remove_cart_item", { cart_id: CART, cart_item_uid: "Mw==" });
    expect(h.lastVariables()).toEqual({ cartId: CART, itemUid: "Mw==" });
    await h.call("magentographql_apply_coupon", { cart_id: CART, coupon_code: "SPRING10" });
    expect(h.lastVariables()).toEqual({ cartId: CART, code: "SPRING10" });
    await h.call("magentographql_remove_coupon", { cart_id: CART });
    expect(h.lastVariables()).toEqual({ cartId: CART });
  });

  it.each([
    ["magentographql_get_cart", { cart_id: "has space" }],
    ["magentographql_add_products_to_cart", { cart_id: CART, items: [] }],
    ["magentographql_add_products_to_cart", { cart_id: CART, items: [{ sku: "A", quantity: 0 }] }],
    ["magentographql_add_products_to_cart", { cart_id: CART, items: [{ sku: "A", quantity: 1001 }] }],
    ["magentographql_apply_coupon", { cart_id: CART, coupon_code: "" }],
  ])("refuses %s %j", async (name, args) => {
    await expect(buildToolHarness(cartTools, data({})).call(name, args)).rejects.toThrow();
  });

  it("marks writes by effect: add is a non-idempotent action, remove is a delete", () => {
    const { tool } = buildToolHarness(cartTools, data({}));
    expect(tool("magentographql_add_products_to_cart").annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(tool("magentographql_remove_cart_item").annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it("selects no customer contact or address data in a cart", () => {
    for (const tool of buildToolHarness(cartTools, data({})).tools) expect(tool.document).not.toMatch(/email|street|telephone|firstname|lastname|shipping_addresses|billing_address/);
  });
});

describe("queryTools", () => {
  it("exposes the generic query and two schema reads, all read", () => {
    const { tools } = buildToolHarness(queryTools, data({}));
    expect(tools.map((t) => t.name).sort()).toEqual(["magentographql_describe_type", "magentographql_list_operations", "magentographql_query"]);
    expect(tools.every((t) => t.access === "read" && t.annotations.readOnlyHint === true)).toBe(true);
  });

  it("runs a query with variables and returns data", async () => {
    const h = buildToolHarness(queryTools, data({ storeConfig: { store_code: "default" } }));
    expect(await h.call("magentographql_query", { query: "query($a: Int) { storeConfig { store_code } }", variables: { a: 1 }, store: "default" })).toEqual({ storeConfig: { store_code: "default" } });
    expect(h.lastVariables()).toEqual({ a: 1 });
  });

  it.each([
    ["a mutation", "mutation { createEmptyCart }"],
    ["a mutation with a query in front", "query A { a } mutation B { createEmptyCart }"],
    ["a mutation hidden after a comment", "# query\nmutation { createEmptyCart }"],
    ["a subscription", "subscription { x }"],
    ["an unreadable document", "{ a "],
  ])("refuses %s and sends nothing", async (_label, query) => {
    const h = buildToolHarness(queryTools, data({}));
    await expect(h.call("magentographql_query", { query })).rejects.toThrow();
    expect(h.double.calls).toHaveLength(0);
  });

  it("refuses an oversized document", async () => {
    await expect(buildToolHarness(queryTools, data({})).call("magentographql_query", { query: `{ ${"a ".repeat(5000)} }` })).rejects.toThrow();
  });

  it("lists root operations, and describes one type by name", async () => {
    const roots = { __schema: { queryType: { fields: [{ name: "products" }] }, mutationType: { fields: [{ name: "createEmptyCart" }] } } };
    expect(await buildToolHarness(queryTools, data(roots)).call("magentographql_list_operations", {})).toEqual(roots.__schema);
    const h = buildToolHarness(queryTools, data({ __type: { name: "ProductInterface", kind: "INTERFACE" } }));
    expect(await h.call("magentographql_describe_type", { type_name: "ProductInterface" })).toEqual({ name: "ProductInterface", kind: "INTERFACE" });
    expect(h.lastVariables()).toEqual({ name: "ProductInterface" });
    await expect(h.call("magentographql_describe_type", { type_name: "bad name" })).rejects.toThrow();
  });

  it("says so when a type does not exist", async () => {
    expect(await buildToolHarness(queryTools, data({ __type: null })).call("magentographql_describe_type", { type_name: "Nope" })).toMatch(/No type named/);
  });
});
