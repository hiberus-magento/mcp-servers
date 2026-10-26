// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Analytics tools: five reads, ported from the original `src/tools/analytics.js`.
// They aggregate over orders, so they are where an unbounded walk and a wrong
// number are most expensive. What differs from the original, each a correction:
//
//   - the walk is BOUNDED. `fetchAllPages` looped until Magento ran out of
//     orders; here a walk takes at most `max_pages` pages of 100 (default 10,
//     ceiling 50), and every aggregate reports `coverage` — how many orders it
//     read, how many exist — plus a loud `warning` when it stopped early,
//     because a partial total that looks complete is the worst answer;
//   - the CURRENCY is the orders' own. The original reported `'USD'` for every
//     store. The amounts summed are the base-currency ones (`base_grand_total`,
//     `base_tax_amount`, falling back to the order-currency ones), and the
//     currency is read from the orders: one code, `null` when there are none,
//     or `mixed` with the list when they span several;
//   - DATES are UTC (`client/date-range.ts`), where the original used the
//     server's local time, and anything unparseable is refused up front;
//   - a COUNTRY must be a known name or a two-letter code. The original turned
//     an unknown name into a code that matched nothing and reported zero;
//   - the customer-orders tool no longer fires one product request per SKU in
//     parallel with no limit. Each order line already carries SKU, name, price
//     and quantity; `magentorest_get_product_by_sku` gives a product's detail.
//
// The aggregates are computed here, so no order — and no billing address,
// phone or street — reaches the model. Only the customer tool returns anything
// per-order, and only SKU, name, price and quantity per line.
//
// UNVERIFIED against a live store, like every tool here; in particular the
// country filter reads `billing_address` and the first shipping assignment from
// the order list, which depends on what the instance returns.
import { z } from "zod";
import {
  MagentoRestError,
  formatDay,
  formatMagentoTimestamp,
  isDateRangeExpression,
  normalizeCountry,
  parseDateRange,
  type AllPagesResult,
  type DateRange,
  type MagentoRestClient,
  type SearchFilter,
} from "../client/index.js";
import type { Shape } from "./project.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";

const TOP_PRODUCTS = 10;

const dateRange = z
  .string()
  .min(1)
  .max(64)
  .refine(isDateRangeExpression, {
    message: "Use today, yesterday, this week, last week, this month, last month, ytd, last year, YYYY-MM-DD, or YYYY-MM-DD to YYYY-MM-DD (a real calendar date; a range up to ten years).",
  })
  .describe("Date range: today, yesterday, this week, last week, this month, last month, ytd, last year, a date (YYYY-MM-DD) or a range (YYYY-MM-DD to YYYY-MM-DD). Resolved in UTC.");

const status = z
  .string()
  .regex(/^[a-z0-9_]{1,32}$/, "lowercase letters, digits and underscores only")
  .optional()
  .describe("Order status code, e.g. processing, complete, pending.");

const country = z
  .string()
  .refine((value) => normalizeCountry(value) !== undefined, { message: "Use a two-letter ISO code (ES) or a known country name (Spain)." })
  .describe("Country: a two-letter ISO code (ES) or a known name (Spain, The Netherlands, United Kingdom).");

const maxPages = z.number().int().min(1).max(50).optional().describe("Most pages of 100 orders to read (default 10, at most 50). A result that hit this limit says so.");

const includeTax = z.boolean().optional().describe("Include tax in the revenue (default true).");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : 0;
  return Number.isFinite(n) ? n : 0;
}

const round2 = (value: number): number => Number(value.toFixed(2));

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** An order amount in the BASE currency, falling back to the order currency when the base one is absent. */
function money(order: unknown, baseKey: string, plainKey: string): number {
  return num(field(order, baseKey) ?? field(order, plainKey));
}

function currencyOf(orders: readonly unknown[]): { readonly currency: string | null; readonly currencies?: readonly string[] } {
  const codes = new Set<string>();
  for (const order of orders) {
    const code = text(field(order, "base_currency_code")) ?? text(field(order, "order_currency_code"));
    if (code !== undefined) {
      codes.add(code);
    }
  }
  const sorted = [...codes].sort();
  if (sorted.length === 0) return { currency: null };
  if (sorted.length === 1) return { currency: sorted[0] as string };
  return { currency: "mixed", currencies: sorted };
}

/** One filter per group: groups are AND'd. The window is the UTC day boundaries of the range. */
function orderFilters(range: DateRange, orderStatus: string | undefined): SearchFilter[][] {
  return [
    [{ field: "created_at", value: formatMagentoTimestamp(range.startDate), conditionType: "gteq" }],
    [{ field: "created_at", value: formatMagentoTimestamp(range.endDate), conditionType: "lteq" }],
    ...(orderStatus !== undefined ? [[{ field: "status", value: orderStatus }]] : []),
  ];
}

function fetchOrders(client: MagentoRestClient, filters: SearchFilter[][], pages: number | undefined): Promise<AllPagesResult> {
  return client.getAllPages("/orders", { filterGroups: filters }, pages !== undefined ? { maxPages: pages } : {});
}

function periodOf(range: DateRange): Record<string, unknown> {
  return { date_range: range.description, period: { start_date: formatDay(range.startDate), end_date: formatDay(range.endDate) } };
}

function coverage(fetched: AllPagesResult): { readonly coverage: Record<string, unknown>; readonly warning?: string } {
  const analysed = fetched.items.length;
  return {
    coverage: { orders_analysed: analysed, orders_in_period: fetched.totalCount, truncated: fetched.truncated },
    ...(fetched.truncated
      ? { warning: `Partial result: only ${analysed} of ${fetched.totalCount} orders were analysed, so these totals understate the period. Raise max_pages (up to 50) or narrow the date range.` }
      : {}),
  };
}

function inCountry(order: unknown, code: string): boolean {
  const billing = text(field(field(order, "billing_address"), "country_id"));
  const assignment = list(field(field(order, "extension_attributes"), "shipping_assignments"))[0];
  const shipping = text(field(field(field(assignment, "shipping"), "address"), "country_id"));
  return [billing, shipping].some((candidate) => candidate?.toUpperCase() === code);
}

function summarizeRevenue(orders: readonly unknown[], withTax: boolean): Record<string, unknown> {
  let gross = 0;
  let tax = 0;
  for (const order of orders) {
    gross += money(order, "base_grand_total", "grand_total");
    tax += money(order, "base_tax_amount", "tax_amount");
  }
  const revenue = withTax ? gross : gross - tax;
  return {
    revenue: round2(revenue),
    ...currencyOf(orders),
    order_count: orders.length,
    average_order_value: orders.length > 0 ? round2(revenue / orders.length) : 0,
    tax_amount: round2(tax),
  };
}

const PERIOD: Shape = ["start_date", "end_date"];
const COVERAGE: Shape = ["orders_analysed", "orders_in_period", "truncated"];
const REVENUE_RESULT: Shape = ["revenue", "currency", "currencies", "order_count", "average_order_value", "tax_amount"];

const revenueShape = (extraQuery: readonly string[]): Shape => [
  ["query", ["date_range", "status", "include_tax", ...extraQuery, ["period", PERIOD]]],
  ["result", REVENUE_RESULT],
  ["coverage", COVERAGE],
  "warning",
];

export function analyticsTools({ readTool }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_revenue",
      description:
        "Use this to total the revenue of a period: revenue, currency, order count, average order value and tax. Computed from the orders in the period; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial.",
      input: z.object({ date_range: dateRange, status, include_tax: includeTax, max_pages: maxPages }).strict(),
      shape: revenueShape([]),
      run: async ({ date_range, status: orderStatus, include_tax, max_pages }, client) => {
        const range = parseDateRange(date_range, new Date());
        const withTax = include_tax !== false;
        const fetched = await fetchOrders(client, orderFilters(range, orderStatus), max_pages);
        return {
          query: { ...periodOf(range), status: orderStatus ?? "All", include_tax: withTax },
          result: summarizeRevenue(fetched.items, withTax),
          ...coverage(fetched),
        };
      },
    }),

    readTool({
      name: "magentorest_get_order_count",
      description: "Use this to count the orders of a period, optionally by status. The count is Magento's own total, so it is exact and is never partial.",
      input: z.object({ date_range: dateRange, status }).strict(),
      shape: [["query", ["date_range", "status", ["period", PERIOD]]], ["result", ["order_count"]]],
      run: async ({ date_range, status: orderStatus }, client) => {
        const range = parseDateRange(date_range, new Date());
        const result = await client.search("/orders", { filterGroups: orderFilters(range, orderStatus), pageSize: 1 });
        return { query: { ...periodOf(range), status: orderStatus ?? "All" }, result: { order_count: result.totalCount } };
      },
    }),

    readTool({
      name: "magentorest_get_product_sales",
      description:
        "Use this to see what sold in a period: orders, items, units, revenue, and the ten best-selling products by quantity with their revenue. Optionally for one country (billing or shipping). Computed from the orders; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial.",
      input: z.object({ date_range: dateRange, status, country: country.optional(), max_pages: maxPages }).strict(),
      shape: [
        ["query", ["date_range", "status", "country", ["period", PERIOD]]],
        [
          "result",
          [
            "total_orders",
            "total_order_items",
            "total_product_quantity",
            "average_products_per_order",
            "total_revenue",
            "average_revenue_per_product",
            "currency",
            "currencies",
            ["top_products", ["sku", "name", "quantity", "revenue"]],
          ],
        ],
        ["coverage", COVERAGE],
        "warning",
      ],
      run: async ({ date_range, status: orderStatus, country: countryInput, max_pages }, client) => {
        const range = parseDateRange(date_range, new Date());
        const code = countryInput !== undefined ? normalizeCountry(countryInput) : undefined;
        const fetched = await fetchOrders(client, orderFilters(range, orderStatus), max_pages);
        const orders = code !== undefined ? fetched.items.filter((order) => inCountry(order, code)) : fetched.items;

        let itemCount = 0;
        let quantity = 0;
        let revenue = 0;
        const products = new Map<string, { sku: string; name: unknown; quantity: number; revenue: number }>();
        for (const order of orders) {
          revenue += money(order, "base_grand_total", "grand_total");
          for (const item of list(field(order, "items"))) {
            const sku = text(field(item, "sku"));
            const qty = num(field(item, "qty_ordered"));
            itemCount += 1;
            quantity += qty;
            if (sku !== undefined) {
              const entry = products.get(sku) ?? { sku, name: field(item, "name"), quantity: 0, revenue: 0 };
              entry.quantity += qty;
              entry.revenue += money(item, "base_price", "price") * qty;
              products.set(sku, entry);
            }
          }
        }
        const top = [...products.values()]
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, TOP_PRODUCTS)
          .map((entry) => ({ sku: entry.sku, name: entry.name, quantity: entry.quantity, revenue: round2(entry.revenue) }));
        return {
          query: { ...periodOf(range), status: orderStatus ?? "All", country: countryInput ?? "All" },
          result: {
            total_orders: orders.length,
            total_order_items: itemCount,
            total_product_quantity: quantity,
            average_products_per_order: orders.length > 0 ? round2(quantity / orders.length) : 0,
            total_revenue: round2(revenue),
            average_revenue_per_product: quantity > 0 ? round2(revenue / quantity) : 0,
            ...currencyOf(orders),
            top_products: top,
          },
          ...coverage(fetched),
        };
      },
    }),

    readTool({
      name: "magentorest_get_revenue_by_country",
      description:
        "Use this to total the revenue of a period for one country (orders billed or shipped there): revenue, currency, order count, average order value and tax. Computed from the orders; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial.",
      input: z.object({ date_range: dateRange, country, status, include_tax: includeTax, max_pages: maxPages }).strict(),
      shape: revenueShape(["country", "normalized_country"]),
      run: async ({ date_range, country: countryInput, status: orderStatus, include_tax, max_pages }, client) => {
        const range = parseDateRange(date_range, new Date());
        const code = normalizeCountry(countryInput) as string;
        const withTax = include_tax !== false;
        const fetched = await fetchOrders(client, orderFilters(range, orderStatus), max_pages);
        const orders = fetched.items.filter((order) => inCountry(order, code));
        return {
          query: { ...periodOf(range), country: countryInput, normalized_country: code, status: orderStatus ?? "All", include_tax: withTax },
          result: summarizeRevenue(orders, withTax),
          ...coverage(fetched),
        };
      },
    }),

    readTool({
      name: "magentorest_get_customer_ordered_products_by_email",
      description:
        "Use this to list every order of one customer, found by exact email, with each order's lines (SKU, name, price, quantity). Returns the customer's id, name and email, never their addresses. For a product's own detail use magentorest_get_product_by_sku. Reads at most max_pages pages of 100 orders and says when the result is partial.",
      input: z.object({ email: z.email().max(254).describe("The customer's email address (exact)."), max_pages: maxPages }).strict(),
      shape: [
        ["customer", ["id", "email", "firstname", "lastname"]],
        ["orders", ["order_id", "increment_id", "created_at", "status", "total", ["items", ["sku", "name", "price", "qty_ordered"]]]],
        ["coverage", ["orders_returned", "orders_total", "truncated"]],
        "warning",
      ],
      run: async ({ email, max_pages }, client) => {
        const customers = await client.search("/customers/search", { filterGroups: [[{ field: "email", value: email }]], pageSize: 1 });
        const customer = customers.items[0];
        if (customer === undefined) {
          throw new MagentoRestError({ kind: "not-found", message: "No customer found with the given email.", status: 404 });
        }
        const fetched = await fetchOrders(client, [[{ field: "customer_email", value: email }]], max_pages);
        const analysed = fetched.items.length;
        return {
          customer,
          orders: fetched.items.map((order) => ({
            order_id: field(order, "entity_id"),
            increment_id: field(order, "increment_id"),
            created_at: field(order, "created_at"),
            status: field(order, "status"),
            total: field(order, "grand_total"),
            items: list(field(order, "items")),
          })),
          coverage: { orders_returned: analysed, orders_total: fetched.totalCount, truncated: fetched.truncated },
          ...(fetched.truncated
            ? { warning: `Partial result: only ${analysed} of ${fetched.totalCount} orders were returned. Raise max_pages (up to 50) to see more.` }
            : {}),
        };
      },
    }),
  ];
}

