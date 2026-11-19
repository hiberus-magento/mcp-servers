// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `analytics.js`, whose defects drive most
// of these cases: a currency hard-coded to USD, `fetchAllPages` with no bound
// (a whole order history into memory), dates in the server's local time, a
// country the original silently matched against nothing, and a per-SKU product
// request fired in parallel with no limit. The aggregates are computed here, so
// no order — and no billing address, phone or street — reaches the model.
import { SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { MagentoRestError } from "../client/index.js";
import { json, type RecordedCall, type RouteTable } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { analyticsTools } from "./analytics-tools.js";

const [SKU, SKU2] = SYNTHETIC_MAGENTO_SKUS;
const build = (routes: RouteTable) => buildToolHarness(analyticsTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

type Json = Record<string, unknown>;
const order = (i: number, overrides: Json = {}): Json => ({
  entity_id: i,
  increment_id: `DEMO${String(i).padStart(9, "0")}`,
  status: "complete",
  created_at: "2026-03-05 10:00:00",
  grand_total: 100,
  base_grand_total: 100,
  tax_amount: 20,
  base_tax_amount: 20,
  order_currency_code: "EUR",
  base_currency_code: "EUR",
  billing_address: { country_id: "ES", street: ["1 Demo Street"], telephone: "000" },
  extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "ES" } } }] },
  items: [{ sku: SKU, name: "Demo Tent", price: 50, base_price: 50, qty_ordered: 2 }],
  ...overrides,
});

/** A `/orders` route that pages an array the way Magento does, 100 to a page. */
const paged = (orders: readonly Json[]) => (call: RecordedCall) => {
  const q = params(call.url);
  const size = Number(q.get("searchCriteria[pageSize]"));
  const page = Number(q.get("searchCriteria[currentPage]"));
  return json(200, { items: orders.slice((page - 1) * size, page * size), total_count: orders.length });
};
const many = (count: number, make: (i: number) => Json = (i) => order(i + 1)): Json[] => Array.from({ length: count }, (_, i) => make(i));

type Out = { query: Json; result: Json; coverage?: Json; warning?: string };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-11T15:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("analyticsTools surface", () => {
  it("exposes five reads and no write", () => {
    const { tools } = build({});
    expect(tools.map((t) => t.name).sort()).toEqual([
      "magentorest_get_customer_ordered_products_by_email",
      "magentorest_get_order_count",
      "magentorest_get_product_sales",
      "magentorest_get_revenue",
      "magentorest_get_revenue_by_country",
    ]);
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });
});

describe("magentorest_get_revenue", () => {
  const three = [order(1), order(2, { base_grand_total: 50, base_tax_amount: 10 }), order(3, { base_grand_total: 50, base_tax_amount: 10 })];

  it("sums the base totals, reports the real currency, and averages", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(three) });
    const out = (await call("magentorest_get_revenue", { date_range: "last week" })) as Out;
    expect(out.result).toEqual({ revenue: 200, currency: "EUR", order_count: 3, average_order_value: 66.67, tax_amount: 40 });
    expect(out.query).toEqual({ date_range: "Last week", status: "All", include_tax: true, period: { start_date: "2026-03-02", end_date: "2026-03-08" } });
    expect(out.coverage).toEqual({ orders_analysed: 3, orders_in_period: 3, truncated: false });
  });

  it("subtracts the tax when include_tax is false", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(three) });
    const out = (await call("magentorest_get_revenue", { date_range: "last week", include_tax: false })) as Out;
    expect(out.result).toMatchObject({ revenue: 160, average_order_value: 53.33, tax_amount: 40 });
    expect(out.query["include_tax"]).toBe(false);
  });

  it("filters by the UTC day boundaries of the range, and by status when given", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": paged(three) });
    await call("magentorest_get_revenue", { date_range: "last week", status: "complete" });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["created_at", "2026-03-02 00:00:00", "gteq"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["created_at", "2026-03-08 23:59:59", "lteq"]);
    expect([f(2, "field"), f(2, "value"), f(2, "condition_type")]).toEqual(["status", "complete", "eq"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("100");
  });

  it("walks every page when it fits inside the cap", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": paged(many(130)) });
    const out = (await call("magentorest_get_revenue", { date_range: "this month" })) as Out;
    expect(double.calls).toHaveLength(2);
    expect(out.coverage).toEqual({ orders_analysed: 130, orders_in_period: 130, truncated: false });
    expect(out.result["order_count"]).toBe(130);
    expect(out).not.toHaveProperty("warning");
  });

  it("stops at max_pages and says the figures are partial, instead of pulling the whole history", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": paged(many(250)) });
    const out = (await call("magentorest_get_revenue", { date_range: "this month", max_pages: 1 })) as Out;
    expect(double.calls).toHaveLength(1);
    expect(out.coverage).toEqual({ orders_analysed: 100, orders_in_period: 250, truncated: true });
    expect(out.result["order_count"]).toBe(100);
    expect(out.warning).toMatch(/partial/i);
    expect(out.warning).toContain("100");
    expect(out.warning).toContain("250");
  });

  it("has a default cap of ten pages, so a forgotten argument is still bounded", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": paged(many(1200)) });
    const out = (await call("magentorest_get_revenue", { date_range: "this month" })) as Out;
    expect(double.calls).toHaveLength(10);
    expect(out.coverage).toEqual({ orders_analysed: 1000, orders_in_period: 1200, truncated: true });
  });

  it("reports the currency the orders were taken in, not a hard-coded one", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged([order(1, { base_currency_code: "GBP", order_currency_code: "GBP" })]) });
    expect(((await call("magentorest_get_revenue", { date_range: "today" })) as Out).result["currency"]).toBe("GBP");
  });

  it("says `mixed` and lists the currencies when orders span more than one", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged([order(1), order(2, { base_currency_code: "USD" })]) });
    const out = (await call("magentorest_get_revenue", { date_range: "today" })) as Out;
    expect(out.result["currency"]).toBe("mixed");
    expect(out.result["currencies"]).toEqual(["EUR", "USD"]);
  });

  it("falls back to the order-currency totals when the base ones are absent", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged([{ entity_id: 1, grand_total: 80, tax_amount: 8, order_currency_code: "EUR" }]) });
    const out = (await call("magentorest_get_revenue", { date_range: "today" })) as Out;
    expect(out.result).toMatchObject({ revenue: 80, tax_amount: 8, currency: "EUR" });
  });

  it("is zero, with no currency and no division by zero, when there are no orders", async () => {
    const { call } = build({ "GET /rest/V1/orders": json(200, { items: [], total_count: 0 }) });
    const out = (await call("magentorest_get_revenue", { date_range: "today" })) as Out;
    expect(out.result).toEqual({ revenue: 0, currency: null, order_count: 0, average_order_value: 0, tax_amount: 0 });
  });

  it("never returns an order, an address or a phone number — only the aggregate", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(many(3, (i) => order(i + 1))) });
    const text = JSON.stringify(await call("magentorest_get_revenue", { date_range: "today" }));
    for (const hidden of ["1 Demo Street", "000", "billing_address", "increment_id", "DEMO0000"]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it.each([
    [{ date_range: "someday" }],
    [{ date_range: "2026-02-30" }],
    [{ date_range: "2026-03-10 to 2026-03-01" }],
    [{ date_range: "" }],
    [{ date_range: "today", status: "Complete" }],
    [{ date_range: "today", status: "a&b" }],
    [{ date_range: "today", include_tax: "yes" }],
    [{ date_range: "today", max_pages: 0 }],
    [{ date_range: "today", max_pages: 51 }],
    [{ date_range: "today", max_pages: 1.5 }],
    [{ date_range: "today", extra: 1 }],
    [{}],
  ])("refuses %j before any request", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_revenue").invoke(bad, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("names the accepted expressions when the range is refused", async () => {
    const { tool } = build({});
    const error = await tool("magentorest_get_revenue").invoke({ date_range: "someday" }, {}).catch((e: unknown) => e);
    expect((error as ZodError).message).toMatch(/last week|YYYY-MM-DD/);
  });
});

describe("magentorest_get_order_count", () => {
  it("asks for one record and reads Magento's own total, so it is exact and never truncated", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": json(200, { items: [order(1)], total_count: 4821 }) });
    const out = (await call("magentorest_get_order_count", { date_range: "2026-01-01 to 2026-01-31", status: "pending" })) as Out;
    const q = params(double.calls[0]?.url);
    expect(q.get("searchCriteria[pageSize]")).toBe("1");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("2026-01-01 00:00:00");
    expect(q.get("searchCriteria[filter_groups][1][filters][0][value]")).toBe("2026-01-31 23:59:59");
    expect(q.get("searchCriteria[filter_groups][2][filters][0][value]")).toBe("pending");
    expect(out.result).toEqual({ order_count: 4821 });
    expect(out.query).toEqual({ date_range: "2026-01-01 to 2026-01-31", status: "pending", period: { start_date: "2026-01-01", end_date: "2026-01-31" } });
    expect(out).not.toHaveProperty("coverage");
  });

  it("is zero when Magento reports no total", async () => {
    const { call } = build({ "GET /rest/V1/orders": json(200, {}) });
    expect(((await call("magentorest_get_order_count", { date_range: "today" })) as Out).result).toEqual({ order_count: 0 });
  });

  it("refuses a bad range or status", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_order_count").invoke({ date_range: "nope" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_order_count").invoke({ date_range: "today", status: "A B" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_get_product_sales", () => {
  const sales = [
    order(1, { items: [{ sku: SKU, name: "Demo Tent", price: 50, base_price: 50, qty_ordered: 2 }, { sku: SKU2, name: "Demo Lamp", price: 30, base_price: 30, qty_ordered: 1 }] }),
    order(2, { items: [{ sku: SKU, name: "Demo Tent", price: 50, base_price: 50, qty_ordered: 3 }] }),
  ];

  it("totals the quantities and ranks the products", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(sales) });
    const out = (await call("magentorest_get_product_sales", { date_range: "this month" })) as Out;
    expect(out.result).toEqual({
      total_orders: 2,
      total_order_items: 3,
      total_product_quantity: 6,
      average_products_per_order: 3,
      total_revenue: 200,
      average_revenue_per_product: 33.33,
      currency: "EUR",
      top_products: [
        { sku: SKU, name: "Demo Tent", quantity: 5, revenue: 250 },
        { sku: SKU2, name: "Demo Lamp", quantity: 1, revenue: 30 },
      ],
    });
    expect(out.query).toMatchObject({ status: "All", country: "All" });
    expect(out.coverage).toEqual({ orders_analysed: 2, orders_in_period: 2, truncated: false });
  });

  it("returns at most the ten best-selling products, most first", async () => {
    const wide = [order(1, { items: Array.from({ length: 12 }, (_, i) => ({ sku: `SKU-${i}`, name: `P${i}`, price: 1, base_price: 1, qty_ordered: i + 1 })) })];
    const { call } = build({ "GET /rest/V1/orders": paged(wide) });
    const top = ((await call("magentorest_get_product_sales", { date_range: "this month" })) as { result: { top_products: { sku: string }[] } }).result.top_products;
    expect(top).toHaveLength(10);
    expect(top[0]?.sku).toBe("SKU-11");
    expect(top[9]?.sku).toBe("SKU-2");
  });

  it("keeps only orders whose billing OR shipping country matches", async () => {
    const mixed = [
      order(1, { billing_address: { country_id: "ES" }, extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "ES" } } }] } }),
      order(2, { billing_address: { country_id: "FR" }, extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "ES" } } }] } }),
      order(3, { billing_address: { country_id: "ES" }, extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "FR" } } }] } }),
      order(4, { billing_address: { country_id: "FR" }, extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "FR" } } }] } }),
    ];
    const { call } = build({ "GET /rest/V1/orders": paged(mixed) });
    const out = (await call("magentorest_get_product_sales", { date_range: "this month", country: "Spain" })) as Out;
    expect(out.result["total_orders"]).toBe(3);
    expect(out.query["country"]).toBe("Spain");
  });

  it("refuses a country that is neither a known name nor a two-letter code, instead of reporting an empty result", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_product_sales").invoke({ date_range: "today", country: "Narnia" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("flags a partial result like the revenue tools", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(many(250)) });
    const out = (await call("magentorest_get_product_sales", { date_range: "this month", max_pages: 1 })) as Out;
    expect(out.coverage).toEqual({ orders_analysed: 100, orders_in_period: 250, truncated: true });
    expect(out.warning).toMatch(/partial/i);
  });

  it("does not echo the orders or their addresses", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(sales.map((o) => injectLeakProbe(o) as Json)) });
    const text = JSON.stringify(await call("magentorest_get_product_sales", { date_range: "this month" }));
    for (const hidden of ["1 Demo Street", "billing_address", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });
});

describe("magentorest_get_revenue_by_country", () => {
  const orders = [
    order(1),
    order(2, { billing_address: { country_id: "FR" }, extension_attributes: { shipping_assignments: [{ shipping: { address: { country_id: "FR" } } }] } }),
    order(3, { base_grand_total: 40, base_tax_amount: 8 }),
  ];

  it("sums only the orders for the country, and shows the code it resolved", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(orders) });
    const out = (await call("magentorest_get_revenue_by_country", { date_range: "this month", country: "Spain" })) as Out;
    expect(out.result).toEqual({ revenue: 140, currency: "EUR", order_count: 2, average_order_value: 70, tax_amount: 28 });
    expect(out.query).toMatchObject({ country: "Spain", normalized_country: "ES", include_tax: true });
  });

  it("accepts a two-letter code and honours include_tax", async () => {
    const { call } = build({ "GET /rest/V1/orders": paged(orders) });
    const out = (await call("magentorest_get_revenue_by_country", { date_range: "this month", country: "fr", include_tax: false })) as Out;
    expect(out.result).toMatchObject({ revenue: 80, order_count: 1 });
    expect(out.query["normalized_country"]).toBe("FR");
  });

  it("filters by status too, and flags a partial result", async () => {
    const { double, call } = build({ "GET /rest/V1/orders": paged(many(250)) });
    const out = (await call("magentorest_get_revenue_by_country", { date_range: "this month", country: "ES", status: "complete", max_pages: 1 })) as Out;
    expect(params(double.calls[0]?.url).get("searchCriteria[filter_groups][2][filters][0][value]")).toBe("complete");
    expect(out.coverage).toMatchObject({ truncated: true });
    expect(out.warning).toMatch(/partial/i);
  });

  it("requires the country, and refuses an unknown one", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_revenue_by_country").invoke({ date_range: "today" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_revenue_by_country").invoke({ date_range: "today", country: "Narnia" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_get_customer_ordered_products_by_email", () => {
  const CUSTOMER = { id: 9, email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "Demo", lastname: "Shopper", dob: "1990-05-05", taxvat: "TAX-DEMO-1", addresses: [{ street: ["1 Demo Street"] }] };
  const routes = (orders: readonly Json[], customers: readonly Json[] = [CUSTOMER]): RouteTable => ({
    "GET /rest/V1/customers/search": json(200, { items: customers, total_count: customers.length }),
    "GET /rest/V1/orders": paged(orders),
  });

  it("finds the customer by exact email, then their orders by the same email", async () => {
    const { double, call } = build(routes([order(1)]));
    await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL });
    const c = params(double.calls[0]?.url);
    expect([c.get("searchCriteria[filter_groups][0][filters][0][field]"), c.get("searchCriteria[filter_groups][0][filters][0][value]"), c.get("searchCriteria[filter_groups][0][filters][0][condition_type]")]).toEqual(["email", SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, "eq"]);
    const o = params(double.calls[1]?.url);
    expect([o.get("searchCriteria[filter_groups][0][filters][0][field]"), o.get("searchCriteria[filter_groups][0][filters][0][value]")]).toEqual(["customer_email", SYNTHETIC_MAGENTO_CUSTOMER_EMAIL]);
  });

  it("returns the customer's identity and each order's lines, with no per-SKU product request", async () => {
    const { double, call, paths } = build(routes([order(1), order(2, { items: [{ sku: SKU2, name: "Demo Lamp", price: 30, qty_ordered: 1, hidden_cost: 5 }] })]));
    const out = (await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL })) as { customer: Json; orders: Json[]; coverage: Json };
    expect(out.customer).toEqual({ id: 9, email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "Demo", lastname: "Shopper" });
    expect(out.orders).toHaveLength(2);
    expect(out.orders[0]).toMatchObject({ order_id: 1, increment_id: "DEMO000000001", status: "complete", total: 100 });
    expect((out.orders[1]?.["items"] as Json[])[0]).toEqual({ sku: SKU2, name: "Demo Lamp", price: 30, qty_ordered: 1 });
    expect(out.coverage).toEqual({ orders_returned: 2, orders_total: 2, truncated: false });
    expect(double.calls).toHaveLength(2);
    expect(paths().some((p) => p.startsWith("/rest/V1/products"))).toBe(false);
  });

  it("returns neither the customer's date of birth, tax number or addresses, nor any order address", async () => {
    const { call } = build(routes([injectLeakProbe(order(1)) as Json], [injectLeakProbe(CUSTOMER) as Json]));
    const text = JSON.stringify(await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL }));
    for (const hidden of ["1990-05-05", "TAX-DEMO-1", "1 Demo Street", "billing_address", "hidden_cost", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it("reports a missing customer as a not-found error, without fetching any order", async () => {
    const { double, tool } = build(routes([order(1)], []));
    const error = await tool("magentorest_get_customer_ordered_products_by_email").invoke({ email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL }, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MagentoRestError);
    expect((error as MagentoRestError).kind).toBe("not-found");
    expect(String((error as Error).message)).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_EMAIL);
    expect(double.calls).toHaveLength(1);
  });

  it("returns an empty order list for a customer who has not ordered", async () => {
    const { call } = build(routes([]));
    const out = (await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL })) as { orders: unknown[]; coverage: Json };
    expect(out.orders).toEqual([]);
    expect(out.coverage).toEqual({ orders_returned: 0, orders_total: 0, truncated: false });
  });

  it("copes with an order that has no lines", async () => {
    const { call } = build(routes([order(1, { items: undefined })]));
    const out = (await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL })) as { orders: Json[] };
    expect(out.orders[0]?.["items"]).toEqual([]);
  });

  it("is bounded: it stops at max_pages and says so", async () => {
    const { double, call } = build(routes(many(250)));
    const out = (await call("magentorest_get_customer_ordered_products_by_email", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, max_pages: 1 })) as { orders: unknown[]; coverage: Json; warning?: string };
    expect(double.calls).toHaveLength(2);
    expect(out.orders).toHaveLength(100);
    expect(out.coverage).toEqual({ orders_returned: 100, orders_total: 250, truncated: true });
    expect(out.warning).toMatch(/partial/i);
  });

  it.each(["not-an-email", "", "a@b", `${"x".repeat(250)}@demo-host.example`])("refuses the email %j before any request", async (email) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_customer_ordered_products_by_email").invoke({ email }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});
