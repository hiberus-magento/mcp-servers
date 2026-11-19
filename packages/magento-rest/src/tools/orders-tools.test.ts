// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `orders.js`. Orders carry addresses and
// payment data, so what matters most is what does NOT come back by default,
// plus the original's two injection-shaped gaps: `sort_field` / `sort_direction`
// spliced raw into the query, and a status value that was never constrained.
import { SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { MagentoRestError } from "../client/index.js";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { orderTools } from "./orders-tools.js";

const INCREMENT = SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID;
const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(orderTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_ITEM = { item_id: 1, sku: "DEMO-TENT-001", name: "Demo Tent", qty_ordered: 2, qty_shipped: 1, qty_invoiced: 2, qty_refunded: 0, price: 50, row_total: 100, tax_amount: 21, discount_amount: 0, product_type: "simple", weee_tax_applied: "secret-internal" };
const RAW_ORDER = {
  entity_id: 4,
  increment_id: INCREMENT,
  status: "processing",
  state: "processing",
  customer_id: 9,
  customer_is_guest: 0,
  customer_email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL,
  customer_firstname: "Demo",
  customer_lastname: "Shopper",
  store_id: 1,
  store_name: "Demo Store",
  order_currency_code: "EUR",
  base_currency_code: "EUR",
  subtotal: 100,
  tax_amount: 21,
  discount_amount: 0,
  shipping_amount: 5,
  grand_total: 126,
  total_qty_ordered: 2,
  total_paid: 126,
  total_refunded: 0,
  shipping_description: "Flat Rate",
  coupon_code: "DEMO10",
  created_at: "2026-01-01 10:00:00",
  updated_at: "2026-01-01 11:00:00",
  billing_address: { street: ["1 Demo Street"], telephone: "000", city: "Madrid" },
  payment: { method: "checkmo", cc_last4: "4242" },
  extension_attributes: { shipping_assignments: [{ shipping: { address: { street: ["1 Demo Street"] } } }] },
  status_histories: [{ comment: "Customer called", entity_id: 1 }],
  items: [RAW_ITEM],
};

describe("orderTools surface", () => {
  it("exposes the five reads and the four writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_order_by_id",
      "magentorest_get_order_by_increment_id",
      "magentorest_get_order_comments",
      "magentorest_get_order_items",
      "magentorest_search_orders",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual([
      "magentorest_add_order_comment",
      "magentorest_cancel_order",
      "magentorest_hold_order",
      "magentorest_unhold_order",
    ]);
  });
});

describe("magentorest_get_order_by_id", () => {
  it("returns totals, state, the customer as recorded and the lines — but no address, payment, history or extension block", async () => {
    const { call } = build({ "GET /rest/V1/orders/4": json(200, injectLeakProbe(RAW_ORDER)) });
    const out = (await call("magentorest_get_order_by_id", { order_id: 4 })) as Record<string, unknown>;
    expect(out["increment_id"]).toBe(INCREMENT);
    expect(out["grand_total"]).toBe(126);
    expect(out["items"]).toHaveLength(1);
    for (const hidden of ["billing_address", "payment", "extension_attributes", "status_histories"]) {
      expect(out, hidden).not.toHaveProperty(hidden);
    }
    const text = JSON.stringify(out);
    for (const secret of ["1 Demo Street", "4242", "checkmo", "Customer called", "secret-internal", LEAK_PROBE_VALUE]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("refuses a non-positive or non-integer ID before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_order_by_id").invoke({ order_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_order_by_id").invoke({ order_id: "4" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_get_order_by_increment_id", () => {
  it("finds the order through an eq filter and returns it projected", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": json(200, { items: [injectLeakProbe(RAW_ORDER)], total_count: 1 }) });
    const out = (await call("magentorest_get_order_by_increment_id", { increment_id: INCREMENT })) as Record<string, unknown>;
    const q = params(double.calls[0]?.url);
    expect(q.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("increment_id");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe(INCREMENT);
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("eq");
    expect(out["entity_id"]).toBe(4);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("reports an order that does not exist as a not-found error, not as a success", async () => {
    const { tool } = build({ "GET /rest/V1/orders": json(200, { items: [], total_count: 0 }) });
    const error = await tool("magentorest_get_order_by_increment_id").invoke({ increment_id: INCREMENT }, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MagentoRestError);
    expect((error as MagentoRestError).kind).toBe("not-found");
    expect((error as MagentoRestError).message).toContain(INCREMENT);
  });

  it.each(["", "1/../x", "a&b", "x".repeat(33), "has space"])("refuses the increment ID %j", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_order_by_increment_id").invoke({ increment_id: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_search_orders", () => {
  it("combines filters with AND, widens the dates to the whole day, and sorts newest first by default", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_orders", { status: "pending", customer_email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, customer_id: 9, date_from: "2026-01-01", date_to: "2026-01-31", grand_total_min: 10, grand_total_max: 500 });
    const q = params(double.calls[0]?.url);
    const f = (group: number, key: string): string | null => q.get(`searchCriteria[filter_groups][${group}][filters][0][${key}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["status", "pending", "eq"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["customer_email", SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, "eq"]);
    expect([f(2, "field"), f(2, "value")]).toEqual(["customer_id", "9"]);
    expect([f(3, "field"), f(3, "value"), f(3, "condition_type")]).toEqual(["created_at", "2026-01-01 00:00:00", "gteq"]);
    expect([f(4, "field"), f(4, "value"), f(4, "condition_type")]).toEqual(["created_at", "2026-01-31 23:59:59", "lteq"]);
    expect([f(5, "field"), f(5, "value"), f(5, "condition_type")]).toEqual(["grand_total", "10", "gteq"]);
    expect([f(6, "field"), f(6, "value"), f(6, "condition_type")]).toEqual(["grand_total", "500", "lteq"]);
    expect(q.get("searchCriteria[sortOrders][0][field]")).toBe("created_at");
    expect(q.get("searchCriteria[sortOrders][0][direction]")).toBe("DESC");
    expect(q.get("searchCriteria[pageSize]")).toBe("20");
  });

  it("returns summaries only: the original's eleven fields plus the currency", async () => {
    const { call } = build({ "GET /rest/V1/orders": json(200, injectLeakProbe({ items: [RAW_ORDER], total_count: 1 })) });
    const out = (await call("magentorest_search_orders", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(Object.keys(out.items[0] ?? {}).sort()).toEqual(
      ["created_at", "customer_email", "customer_firstname", "customer_lastname", "entity_id", "grand_total", "increment_id", "order_currency_code", "state", "status", "total_qty_ordered", "updated_at"].sort(),
    );
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("honours an explicit sort field and direction", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_orders", { sort_field: "grand_total", sort_direction: "ASC" });
    const q = params(double.calls[0]?.url);
    expect(q.get("searchCriteria[sortOrders][0][field]")).toBe("grand_total");
    expect(q.get("searchCriteria[sortOrders][0][direction]")).toBe("ASC");
  });

  it("refuses a sort field or direction that could append criteria — the original's injection", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_search_orders").invoke({ sort_field: "created_at&searchCriteria[pageSize]=9999" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_search_orders").invoke({ sort_direction: "DESC&x=1" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it.each(["Pending", "pending; DROP", "a&b", "", "x".repeat(33)])("refuses the status %j, which the original never constrained", async (bad) => {
    const { tool } = build({});
    await expect(tool("magentorest_search_orders").invoke({ status: bad }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it.each(["yesterday", "2026-1-1", "2026-01-01 10:00:00"])("refuses the date %j", async (bad) => {
    const { tool } = build({});
    await expect(tool("magentorest_search_orders").invoke({ date_from: bad }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_search_orders").invoke({ date_to: bad }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("refuses a page size above 100 and a negative total", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_search_orders").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_search_orders").invoke({ grand_total_min: -1 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_order_items", () => {
  it("returns the lines only, projected", async () => {
    const { call } = build({ "GET /rest/V1/orders/4": json(200, injectLeakProbe(RAW_ORDER)) });
    const out = (await call("magentorest_get_order_items", { order_id: 4 })) as Record<string, unknown>[];
    expect(out).toHaveLength(1);
    expect(out[0]?.["sku"]).toBe("DEMO-TENT-001");
    expect(JSON.stringify(out)).not.toContain("secret-internal");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("returns an empty list for an order with no items", async () => {
    const { call } = build({ "GET /rest/V1/orders/4": json(200, { entity_id: 4 }) });
    expect(await call("magentorest_get_order_items", { order_id: 4 })).toEqual([]);
  });
});

describe("magentorest_get_order_comments", () => {
  it("returns the status history, projected", async () => {
    const history = [{ entity_id: 1, parent_id: 4, status: "processing", comment: "Shipped by courier", created_at: "2026-01-02 09:00:00", is_customer_notified: 1, is_visible_on_front: 0, entity_name: "order", hidden: "x" }];
    const { call } = build({ "GET /rest/V1/orders/4": json(200, injectLeakProbe({ entity_id: 4, status_histories: history })) });
    const out = (await call("magentorest_get_order_comments", { order_id: 4 })) as Record<string, unknown>[];
    expect(out[0]?.["comment"]).toBe("Shipped by courier");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(out[0]).not.toHaveProperty("hidden");
  });

  it("returns an empty list when there is no history", async () => {
    const { call } = build({ "GET /rest/V1/orders/4": json(200, { entity_id: 4 }) });
    expect(await call("magentorest_get_order_comments", { order_id: 4 })).toEqual([]);
  });
});

describe("order statuses are deliberately not offered", () => {
  // The original called GET /orders/statuses. Against a live Magento 2.4.8-p5 that is
  // answered 400 — "The \"statuses\" value's type is invalid. The \"int\" type was
  // expected." — because Magento reads it as /orders/{id} with id "statuses". There is no
  // such collection route, so a tool for it can only ever fail.
  it("has no get_order_statuses tool", () => {
    expect(build({}).tools.map((t) => t.name)).not.toContain("magentorest_get_order_statuses");
  });
});

describe("order writes", () => {
  it("add_order_comment sends flags as 0/1, defaults to silent and hidden, and links the parent", async () => {
    const { double, call } = build({ "POST /rest/V1/orders/4/comments": json(200, true) });
    await call("magentorest_add_order_comment", { order_id: 4, comment: "Packed." });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ statusHistory: { comment: "Packed.", is_customer_notified: 0, is_visible_on_front: 0, parent_id: 4 } });
  });

  it("add_order_comment carries a status change and the notify flags only when asked", async () => {
    const { double, call } = build({ "POST /rest/V1/orders/4/comments": json(200, true) });
    await call("magentorest_add_order_comment", { order_id: 4, comment: "Shipped.", status: "complete", is_customer_notified: true, is_visible_on_front: true });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ statusHistory: { comment: "Shipped.", is_customer_notified: 1, is_visible_on_front: 1, parent_id: 4, status: "complete" } });
  });

  it("add_order_comment refuses an empty comment and a malformed status", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_add_order_comment").invoke({ order_id: 4, comment: "" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_add_order_comment").invoke({ order_id: 4, comment: "x", status: "A B" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it.each([
    ["magentorest_cancel_order", "cancel"],
    ["magentorest_hold_order", "hold"],
    ["magentorest_unhold_order", "unhold"],
  ])("%s POSTs /orders/{id}/%s with no body and returns Magento's boolean", async (name, verb) => {
    const { double, call } = build({ [`POST /rest/V1/orders/4/${verb}`]: json(200, true) });
    expect(await call(name, { order_id: 4 })).toBe(true);
    expect(double.calls[0]?.method).toBe("POST");
    expect(double.calls[0]?.body).toBeUndefined();
  });

  it("a state-changing action is destructive and not idempotent; a comment is neither", () => {
    const { tool } = build({});
    for (const name of ["magentorest_cancel_order", "magentorest_hold_order", "magentorest_unhold_order"]) {
      expect(tool(name).annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    }
    expect(tool("magentorest_add_order_comment").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it("never replays a cancel on a retryable failure", async () => {
    const { double, tool } = build({ "POST /rest/V1/orders/4/cancel": json(503, { message: "busy" }) });
    await expect(tool("magentorest_cancel_order").invoke({ order_id: 4 }, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });
});
