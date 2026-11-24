// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Typed conditions on the cart price rule writes and read (Kora phase B; feature doc
// odd/tasks/magento-rest-sales-rule-conditions.md, S1-S8). Magento facts these tests pin (2.4-develop source):
//   - REST carries a rule's conditions as ConditionInterface trees, `condition` (the cart) and `action_condition`
//     (the items the discount applies to); a tree sent in a PUT replaces the stored one, and a root with no children
//     clears it;
//   - product conditions on the cart sit under a Product\Found combine (value 1 FOUND, 0 NOT FOUND);
//   - simple_free_shipping travels as Magento stores it: "0" none, "1" matching items, "2" the whole shipment.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json, type RecordedCall } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { promotionTools } from "./promotions-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(promotionTools, routes);
const bodyOf = (call: RecordedCall | undefined): unknown => JSON.parse(call?.body ?? "null");
const puts = (calls: readonly RecordedCall[]): RecordedCall[] => calls.filter((call) => call.method === "PUT");

const CREATE = "magentorest_create_sales_rule";
const UPDATE = "magentorest_update_sales_rule";
const READ = "magentorest_get_sales_rule_by_id";

const COMBINE = "Magento\\SalesRule\\Model\\Rule\\Condition\\Combine";
const ADDRESS = "Magento\\SalesRule\\Model\\Rule\\Condition\\Address";
const FOUND = "Magento\\SalesRule\\Model\\Rule\\Condition\\Product\\Found";
const PRODUCT = "Magento\\SalesRule\\Model\\Rule\\Condition\\Product";
const PRODUCT_COMBINE = "Magento\\SalesRule\\Model\\Rule\\Condition\\Product\\Combine";

const leaf = (type: string, attribute: string, operator: string, value: string) => ({ condition_type: type, attribute_name: attribute, operator, value });
const combine = (type: string, value: string, conditions: unknown[]) => ({ condition_type: type, aggregator_type: "all", value, conditions });

/** Every condition kind, as a caller writes it. */
const ALL_CART = [
  { type: "subtotal_at_least", amount: 100 },
  { type: "subtotal_at_most", amount: 499.9 },
  { type: "total_qty_at_least", qty: 2 },
  { type: "total_qty_at_most", qty: 10 },
  { type: "shipping_country_is", country: "ES" },
  { type: "shipping_country_is_not", country: "PT" },
  { type: "cart_has_product_in_categories", category_ids: [3, 5] },
  { type: "cart_has_no_product_in_categories", category_ids: [7] },
  { type: "cart_has_sku", skus: ["SKU-1", "SKU-2"] },
];
const ALL_ITEMS = [
  { type: "category_in", category_ids: [3] },
  { type: "category_not_in", category_ids: [9, 4] },
  { type: "sku_in", skus: ["SKU-1"] },
];

/** The same conditions, as Magento's trees. */
const CART_TREE = combine(COMBINE, "1", [
  leaf(ADDRESS, "base_subtotal", ">=", "100"),
  leaf(ADDRESS, "base_subtotal", "<=", "499.9"),
  leaf(ADDRESS, "total_qty", ">=", "2"),
  leaf(ADDRESS, "total_qty", "<=", "10"),
  leaf(ADDRESS, "country_id", "==", "ES"),
  leaf(ADDRESS, "country_id", "!=", "PT"),
  combine(FOUND, "1", [leaf(PRODUCT, "category_ids", "()", "3,5")]),
  combine(FOUND, "0", [leaf(PRODUCT, "category_ids", "()", "7")]),
  combine(FOUND, "1", [leaf(PRODUCT, "sku", "()", "SKU-1,SKU-2")]),
]);
const ITEM_TREE = combine(PRODUCT_COMBINE, "1", [
  leaf(PRODUCT, "category_ids", "()", "3"),
  leaf(PRODUCT, "category_ids", "!()", "4,9"),
  leaf(PRODUCT, "sku", "()", "SKU-1"),
]);
const EMPTY_CART = combine(COMBINE, "1", []);
const EMPTY_ITEMS = combine(PRODUCT_COMBINE, "1", []);

const STORED = {
  rule_id: 3,
  name: "Demo 10%",
  is_active: true,
  simple_action: "by_percent",
  discount_amount: 10,
  coupon_type: "NO_COUPON",
  website_ids: [1],
  customer_group_ids: [0, 1],
  simple_free_shipping: "0",
  condition: EMPTY_CART,
  action_condition: EMPTY_ITEMS,
};
const CREATE_ARGS = { name: "Spring 10%", is_active: true, website_ids: [1], customer_group_ids: [0, 1], simple_action: "by_percent", discount_amount: 10, coupon_type: "NO_COUPON" };

describe("create_sales_rule with conditions", () => {
  it("sends every condition kind as Magento's trees, and the free shipping value", async () => {
    const created = { ...STORED, rule_id: 9 };
    const { double, call } = build({ "POST /rest/V1/salesRules": json(200, created), "GET /rest/V1/salesRules/9": json(200, created) });
    await call(CREATE, { ...CREATE_ARGS, conditions: ALL_CART, item_conditions: ALL_ITEMS, free_shipping: "whole_cart" });
    const rule = (bodyOf(double.calls[0]) as { rule: Record<string, unknown> }).rule;
    expect(rule["condition"]).toEqual(CART_TREE);
    expect(rule["action_condition"]).toEqual(ITEM_TREE);
    expect(rule["simple_free_shipping"]).toBe("2");
  });

  it("maps each free shipping choice to Magento's stored value", async () => {
    for (const [choice, value] of [["none", "0"], ["matching_items", "1"], ["whole_cart", "2"]] as const) {
      const { double, call } = build({ "POST /rest/V1/salesRules": json(200, { ...STORED, rule_id: 9 }), "GET /rest/V1/salesRules/9": json(200, STORED) });
      await call(CREATE, { ...CREATE_ARGS, free_shipping: choice });
      expect((bodyOf(double.calls[0]) as { rule: Record<string, unknown> }).rule["simple_free_shipping"], choice).toBe(value);
    }
  });

  it("sends no tree for an empty list: a new rule has no conditions anyway", async () => {
    const { double, call } = build({ "POST /rest/V1/salesRules": json(200, { ...STORED, rule_id: 9 }), "GET /rest/V1/salesRules/9": json(200, STORED) });
    await call(CREATE, { ...CREATE_ARGS, conditions: [], item_conditions: [] });
    const rule = (bodyOf(double.calls[0]) as { rule: Record<string, unknown> }).rule;
    expect(rule).not.toHaveProperty("condition");
    expect(rule).not.toHaveProperty("action_condition");
  });

  it.each([
    ["a Magento class string", { conditions: [{ type: ADDRESS, attribute_name: "weight" }] }],
    ["an unknown kind", { conditions: [{ type: "weight_at_least", amount: 1 }] }],
    ["a nested tree", { conditions: [{ type: "subtotal_at_least", amount: 1, conditions: [] }] }],
    ["a negative amount", { conditions: [{ type: "subtotal_at_least", amount: -1 }] }],
    ["a fractional quantity", { conditions: [{ type: "total_qty_at_least", qty: 1.5 }] }],
    ["a lowercase country", { conditions: [{ type: "shipping_country_is", country: "es" }] }],
    ["an empty category list", { conditions: [{ type: "cart_has_product_in_categories", category_ids: [] }] }],
    ["a non-positive category id", { item_conditions: [{ type: "category_in", category_ids: [0] }] }],
    ["a SKU with a comma (Magento splits on it)", { conditions: [{ type: "cart_has_sku", skus: ["A,B"] }] }],
    ["a SKU with a semicolon", { item_conditions: [{ type: "sku_in", skus: ["A;B"] }] }],
    ["a cart-only kind among the item conditions", { item_conditions: [{ type: "subtotal_at_least", amount: 1 }] }],
    ["null in place of a list", { conditions: null }],
    ["more than 20 conditions", { conditions: Array.from({ length: 21 }, (_, i) => ({ type: "total_qty_at_least", qty: i })) }],
    ["an unknown free shipping value", { free_shipping: "always" }],
  ])("refuses %s before any request", async (_label, extra) => {
    const { double, tool } = build({});
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, ...extra }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses an id or SKU listed twice in one condition, before any request", async () => {
    const { double, tool } = build({});
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, conditions: [{ type: "cart_has_product_in_categories", category_ids: [3, 3] }] }, {})).rejects.toMatchObject({ argument: "conditions" });
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, item_conditions: [{ type: "sku_in", skus: ["A", "A"] }] }, {})).rejects.toMatchObject({ argument: "item_conditions" });
    expect(double.calls).toHaveLength(0);
  });
});

describe("get_sales_rule_by_id reads the typed conditions back", () => {
  it("returns every kind in the shape the writes take, with free_shipping", async () => {
    const stored = { ...STORED, condition: CART_TREE, action_condition: ITEM_TREE, simple_free_shipping: "2" };
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, stored) });
    const out = (await call(READ, { rule_id: 3 })) as Record<string, unknown>;
    expect(out["conditions"]).toEqual(ALL_CART);
    expect(out["item_conditions"]).toEqual([ALL_ITEMS[0], { type: "category_not_in", category_ids: [4, 9] }, ALL_ITEMS[2]]);
    expect(out).toMatchObject({ conditions_supported: true, item_conditions_supported: true, free_shipping: "whole_cart" });
  });

  it("reads values the admin saved with spaces, numbers as strings and the flags as numbers", async () => {
    const tree = combine(COMBINE, "1", [
      { ...leaf(ADDRESS, "base_subtotal", ">=", "100.0000"), aggregator_type: null },
      { condition_type: FOUND, aggregator_type: "all", value: 1, conditions: [leaf(PRODUCT, "category_ids", "()", "3, 5")] },
      { condition_type: FOUND, aggregator_type: "all", value: "1", conditions: [leaf(PRODUCT, "sku", "()", "SKU-1 ; SKU-2")] },
    ]);
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, condition: tree, simple_free_shipping: 1 }) });
    const out = (await call(READ, { rule_id: 3 })) as Record<string, unknown>;
    expect(out["conditions"]).toEqual([
      { type: "subtotal_at_least", amount: 100 },
      { type: "cart_has_product_in_categories", category_ids: [3, 5] },
      { type: "cart_has_sku", skus: ["SKU-1", "SKU-2"] },
    ]);
    expect(out["free_shipping"]).toBe("matching_items");
  });

  it("reads no tree, an empty tree and no free shipping value as nothing set", async () => {
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, condition: null, action_condition: undefined, simple_free_shipping: null }) });
    const out = (await call(READ, { rule_id: 3 })) as Record<string, unknown>;
    expect(out).toMatchObject({ conditions: [], conditions_supported: true, item_conditions: [], item_conditions_supported: true, free_shipping: "none" });
  });

  it.each([
    ["an ANY aggregator", { ...CART_TREE, aggregator_type: "any" }],
    ["a FALSE root", { ...CART_TREE, value: "0" }],
    ["an attribute outside the list", combine(COMBINE, "1", [leaf(ADDRESS, "weight", ">=", "1")])],
    ["an operator outside the list", combine(COMBINE, "1", [leaf(ADDRESS, "base_subtotal", ">", "1")])],
    ["a product found under two conditions", combine(COMBINE, "1", [combine(FOUND, "1", [leaf(PRODUCT, "sku", "()", "A"), leaf(PRODUCT, "sku", "()", "B")])])],
    ["a nested combine", combine(COMBINE, "1", [combine(COMBINE, "1", [])])],
    ["a product condition with an attribute scope", combine(COMBINE, "1", [combine(FOUND, "1", [{ ...leaf(PRODUCT, "sku", "()", "A"), extension_attributes: { attribute_scope: "parent" } }])])],
    ["a category value that is not ids", combine(COMBINE, "1", [combine(FOUND, "1", [leaf(PRODUCT, "category_ids", "()", "3,x")])])],
  ])("reports %s as unsupported, without guessing the conditions", async (_label, tree) => {
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, condition: tree }) });
    const out = (await call(READ, { rule_id: 3 })) as Record<string, unknown>;
    expect(out["conditions_supported"]).toBe(false);
    expect(out).not.toHaveProperty("conditions");
    expect(out["item_conditions_supported"]).toBe(true);
  });

  it("reports an item tree outside the list as unsupported", async () => {
    const tree = combine(PRODUCT_COMBINE, "1", [leaf(PRODUCT, "price", ">=", "10")]);
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, action_condition: tree }) });
    const out = (await call(READ, { rule_id: 3 })) as Record<string, unknown>;
    expect(out).toMatchObject({ item_conditions_supported: false, conditions_supported: true });
    expect(out).not.toHaveProperty("item_conditions");
  });
});

describe("update_sales_rule replaces the condition sets", () => {
  const PUT = "PUT /rest/V1/salesRules/3";

  it("sends only the set that differs, as a whole tree, and no unchanged member", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [PUT]: json(200, STORED) });
    await call(UPDATE, { rule_id: 3, name: "Demo 10%", conditions: ALL_CART, item_conditions: [], free_shipping: "none" });
    expect(puts(double.calls)).toHaveLength(1);
    expect(bodyOf(puts(double.calls)[0])).toEqual({ rule: { condition: CART_TREE } });
  });

  it("clears a set with an empty list: a root with no conditions", async () => {
    const stored = { ...STORED, condition: CART_TREE, action_condition: ITEM_TREE };
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, stored), [PUT]: json(200, STORED) });
    await call(UPDATE, { rule_id: 3, conditions: [], item_conditions: [] });
    expect(bodyOf(puts(double.calls)[0])).toEqual({ rule: { condition: EMPTY_CART, action_condition: EMPTY_ITEMS } });
  });

  it("sends nothing when the stored sets already hold the given conditions, in any order", async () => {
    const stored = { ...STORED, condition: CART_TREE, action_condition: ITEM_TREE, simple_free_shipping: "2" };
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, stored) });
    const shuffled = [...ALL_CART].reverse().map((c) => ("category_ids" in c ? { ...c, category_ids: [...c.category_ids].reverse() } : c));
    await call(UPDATE, { rule_id: 3, conditions: shuffled, item_conditions: ALL_ITEMS, free_shipping: "whole_cart" });
    expect(puts(double.calls)).toHaveLength(0);
  });

  it("writes back what the read returned: an undo restores the earlier sets", async () => {
    const before = { ...STORED, condition: CART_TREE, action_condition: ITEM_TREE, simple_free_shipping: "1" };
    const read = build({ "GET /rest/V1/salesRules/3": json(200, before) });
    const snapshot = (await read.call(READ, { rule_id: 3 })) as Record<string, unknown>;
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [PUT]: json(200, before) });
    await call(UPDATE, { rule_id: 3, conditions: snapshot["conditions"], item_conditions: snapshot["item_conditions"], free_shipping: snapshot["free_shipping"] });
    expect(bodyOf(puts(double.calls)[0])).toEqual({ rule: { condition: CART_TREE, action_condition: combine(PRODUCT_COMBINE, "1", [leaf(PRODUCT, "category_ids", "()", "3"), leaf(PRODUCT, "category_ids", "!()", "4,9"), leaf(PRODUCT, "sku", "()", "SKU-1")]), simple_free_shipping: "1" } });
  });

  it("changes free shipping alone", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, simple_free_shipping: null }), [PUT]: json(200, STORED) });
    await call(UPDATE, { rule_id: 3, free_shipping: "none" });
    expect(puts(double.calls)).toHaveLength(0);
    const set = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [PUT]: json(200, STORED) });
    await set.call(UPDATE, { rule_id: 3, free_shipping: "matching_items" });
    expect(bodyOf(puts(set.double.calls)[0])).toEqual({ rule: { simple_free_shipping: "1" } });
  });

  it("refuses to replace a stored set it cannot represent, and writes nothing", async () => {
    const stored = { ...STORED, condition: combine(COMBINE, "1", [leaf(ADDRESS, "weight", ">=", "1")]) };
    const { double, tool } = build({ "GET /rest/V1/salesRules/3": json(200, stored) });
    await expect(tool(UPDATE).invoke({ rule_id: 3, conditions: [], is_active: false }, {})).rejects.toMatchObject({ code: "invalid_argument", argument: "conditions" });
    expect(puts(double.calls)).toHaveLength(0);
  });

  it("replaces it when replace_unsupported_conditions is true", async () => {
    const stored = { ...STORED, condition: combine(COMBINE, "1", [leaf(ADDRESS, "weight", ">=", "1")]) };
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, stored), [PUT]: json(200, STORED) });
    await call(UPDATE, { rule_id: 3, conditions: [{ type: "subtotal_at_least", amount: 50 }], replace_unsupported_conditions: true });
    expect(bodyOf(puts(double.calls)[0])).toEqual({ rule: { condition: combine(COMBINE, "1", [leaf(ADDRESS, "base_subtotal", ">=", "50")]) } });
  });

  it("leaves an unsupported set alone when the update does not pass it", async () => {
    const stored = { ...STORED, condition: combine(COMBINE, "1", [leaf(ADDRESS, "weight", ">=", "1")]) };
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, stored), [PUT]: json(200, STORED) });
    await call(UPDATE, { rule_id: 3, is_active: false });
    expect(bodyOf(puts(double.calls)[0])).toEqual({ rule: { is_active: false } });
  });

  it("does not count replace_unsupported_conditions alone as something to change", async () => {
    const { double, tool } = build({});
    await expect(tool(UPDATE).invoke({ rule_id: 3, replace_unsupported_conditions: true }, {})).rejects.toMatchObject({ argument: "rule_id" });
    expect(double.calls).toHaveLength(0);
  });

  it("refuses null in place of a list: clearing is an empty list", async () => {
    const { double, tool } = build({});
    await expect(tool(UPDATE).invoke({ rule_id: 3, conditions: null }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});
