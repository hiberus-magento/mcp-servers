// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `carts.js`, minus two tools that are
// deliberately NOT ported: `get_shipping_methods` and `get_payment_methods`
// call `/shipping-methods` and `/payment-methods`, which are not standard
// Magento REST endpoints (the methods are per cart), and the first fell back to
// returning the store configuration — an answer to a different question.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { cartTools } from "./carts-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(cartTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_CART = {
  id: 21,
  created_at: "2026-03-01 10:00:00",
  updated_at: "2026-03-02 10:00:00",
  is_active: true,
  is_virtual: false,
  items_count: 1,
  items_qty: 2,
  store_id: 1,
  customer_is_guest: false,
  customer: { id: 9, email: "shopper@demo-host.example", firstname: "Demo", lastname: "Shopper", group_id: 1, dob: "1990-05-05", taxvat: "TAX-DEMO-1" },
  currency: { global_currency_code: "EUR", base_currency_code: "EUR", store_currency_code: "EUR", quote_currency_code: "EUR", store_to_base_rate: 1 },
  billing_address: { street: ["1 Demo Street"], telephone: "000" },
  items: [{ item_id: 1, quote_id: "21", sku: "DEMO-TENT-001", name: "Demo Tent", qty: 2, price: 50, product_type: "simple", extension_attributes: { secret: "x" } }],
};

describe("cartTools surface", () => {
  it("exposes four reads and no write", () => {
    const { tools } = build({});
    expect(tools.map((t) => t.name).sort()).toEqual(["magentorest_get_abandoned_carts", "magentorest_get_cart_by_id", "magentorest_get_cart_items", "magentorest_search_carts"]);
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });

  it("deliberately omits the shipping-methods and payment-methods tools", () => {
    const names = build({}).tools.map((t) => t.name);
    expect(names).not.toContain("magentorest_get_shipping_methods");
    expect(names).not.toContain("magentorest_get_payment_methods");
  });
});

describe("magentorest_get_cart_by_id", () => {
  it("returns the cart with the customer's identity and the lines, but no address, date of birth or tax number", async () => {
    const { call } = build({ "GET /rest/V1/carts/21": json(200, injectLeakProbe(RAW_CART)) });
    const out = (await call("magentorest_get_cart_by_id", { cart_id: 21 })) as Record<string, unknown>;
    expect(out["items_count"]).toBe(1);
    expect((out["customer"] as Record<string, unknown>)["email"]).toBe("shopper@demo-host.example");
    const text = JSON.stringify(out);
    for (const hidden of ["1 Demo Street", "1990-05-05", "TAX-DEMO-1", '"secret"', "store_to_base_rate", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
    expect(out["items"]).toHaveLength(1);
  });

  it("refuses a non-positive ID before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_cart_by_id").invoke({ cart_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_search_carts", () => {
  it("combines filters with AND, maps the flag to 1/0, and widens the dates to whole days", async () => {
    const { double, call } = build({ "GET /rest/V1/carts/search": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_carts", { customer_email: "shopper@demo-host.example", customer_id: 9, is_active: false, created_at_from: "2026-03-01", created_at_to: "2026-03-31" });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["customer_email", "shopper@demo-host.example", "eq"]);
    expect([f(1, "field"), f(1, "value")]).toEqual(["customer_id", "9"]);
    expect([f(2, "field"), f(2, "value")]).toEqual(["is_active", "0"]);
    expect([f(3, "field"), f(3, "value"), f(3, "condition_type")]).toEqual(["created_at", "2026-03-01 00:00:00", "gteq"]);
    expect([f(4, "field"), f(4, "value"), f(4, "condition_type")]).toEqual(["created_at", "2026-03-31 23:59:59", "lteq"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("20");
  });

  it("returns summaries with the customer's identity only", async () => {
    const { call } = build({ "GET /rest/V1/carts/search": json(200, injectLeakProbe({ items: [RAW_CART], total_count: 1 })) });
    const out = (await call("magentorest_search_carts", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(out.items[0]).not.toHaveProperty("items");
    expect(out.items[0]).not.toHaveProperty("billing_address");
    expect(JSON.stringify(out)).not.toContain("TAX-DEMO-1");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("refuses a bad date and a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_search_carts").invoke({ created_at_from: "yesterday" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_search_carts").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_cart_items", () => {
  it("returns the lines, projected", async () => {
    const { call } = build({ "GET /rest/V1/carts/21/items": json(200, injectLeakProbe(RAW_CART.items)) });
    const out = (await call("magentorest_get_cart_items", { cart_id: 21 })) as Record<string, unknown>[];
    expect(out[0]?.["sku"]).toBe("DEMO-TENT-001");
    expect(JSON.stringify(out)).not.toContain('"secret"');
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });
});

describe("magentorest_get_abandoned_carts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for active, non-empty carts not touched since the cutoff, most recently updated first", async () => {
    const { double, call } = build({ "GET /rest/V1/carts/search": json(200, { items: [], total_count: 0 }) });
    const out = (await call("magentorest_get_abandoned_carts", {})) as { criteria: Record<string, unknown> };
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["is_active", "1", "eq"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["updated_at", "2026-03-03 12:00:00", "lteq"]);
    expect([f(2, "field"), f(2, "value"), f(2, "condition_type")]).toEqual(["items_count", "0", "gt"]);
    expect(q.get("searchCriteria[sortOrders][0][field]")).toBe("updated_at");
    expect(q.get("searchCriteria[sortOrders][0][direction]")).toBe("DESC");
    expect(q.get("searchCriteria[pageSize]")).toBe("50");
    expect(out.criteria).toEqual({ days_abandoned: 7, cutoff_date: "2026-03-03 12:00:00" });
  });

  it("computes the cutoff in UTC from days_old", async () => {
    const { double, call } = build({ "GET /rest/V1/carts/search": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_get_abandoned_carts", { days_old: 30 });
    expect(params(double.calls[0]?.url).get("searchCriteria[filter_groups][1][filters][0][value]")).toBe("2026-02-08 12:00:00");
  });

  it("names the owner from the customer record, or the cart's email, or Guest", async () => {
    const items = [
      { id: 1, customer: { email: "a@demo-host.example", firstname: "Ann", lastname: "Demo" }, items_count: 2, grand_total: 40, created_at: "c", updated_at: "u" },
      { id: 2, customer_email: "guest@demo-host.example", items_count: 1, created_at: "c", updated_at: "u" },
      { id: 3, items_count: 1, created_at: "c", updated_at: "u" },
    ];
    const { call } = build({ "GET /rest/V1/carts/search": json(200, injectLeakProbe({ items, total_count: 3 })) });
    const out = (await call("magentorest_get_abandoned_carts", {})) as { total_count: number; items: Record<string, unknown>[] };
    expect(out.total_count).toBe(3);
    expect(out.items.map((i) => [i["cart_id"], i["customer_email"], i["customer_name"]])).toEqual([
      [1, "a@demo-host.example", "Ann Demo"],
      [2, "guest@demo-host.example", "Guest"],
      [3, undefined, "Guest"],
    ]);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each([-1, 1.5, 3651])("refuses days_old %s", async (days) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_abandoned_carts").invoke({ days_old: days }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});
