// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `stock.js`. Two corrections come from
// reading the shape of Magento's own endpoint rather than the original's call:
// `/stockItems/lowStock` takes `scopeId`, `qty`, `pageSize` and `currentPage`,
// not `searchCriteria` filters, so the original's filters were ignored. Both
// are UNVERIFIED against a live store.
import { SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { stockTools } from "./stock-tools.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(stockTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_STOCK = { item_id: 1, product_id: 7, stock_id: 1, qty: 12, is_in_stock: true, manage_stock: true, min_qty: 0, min_sale_qty: 1, max_sale_qty: 10000, backorders: 0, low_stock_date: null, stock_status_changed_auto: 0, internal_note: "secret" };

describe("stockTools surface", () => {
  it("exposes the five reads and the one write, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_inventory_sources",
      "magentorest_get_inventory_stocks",
      "magentorest_get_low_stock_products",
      "magentorest_get_product_stock",
      "magentorest_get_source_items",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name)).toEqual(["magentorest_update_product_stock"]);
  });
});

describe("magentorest_get_product_stock", () => {
  it("reads the stock item and projects it", async () => {
    const { call } = build({ [`GET /rest/V1/stockItems/${SKU}`]: json(200, injectLeakProbe(RAW_STOCK)) });
    const out = (await call("magentorest_get_product_stock", { sku: SKU })) as Record<string, unknown>;
    expect(out["qty"]).toBe(12);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("encodes a SKU that tries to re-address the request", async () => {
    const { double, tool } = build({ "GET /rest/V1/stockItems/a%2F..%2F..%2Forders": json(404, { message: "no" }) });
    await expect(tool("magentorest_get_product_stock").invoke({ sku: "a/../../orders" }, {})).rejects.toMatchObject({ kind: "not-found" });
    expect(double.calls.map((c) => new URL(c.url).pathname)).toEqual(["/rest/V1/stockItems/a%2F..%2F..%2Forders"]);
  });

  it("refuses an empty SKU", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_product_stock").invoke({ sku: "" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_update_product_stock", () => {
  it("PUTs the stock item for the default stock and derives in-stock from the quantity", async () => {
    const { double, call } = build({ [`PUT /rest/V1/products/${SKU}/stockItems/1`]: json(200, 1) });
    expect(await call("magentorest_update_product_stock", { sku: SKU, qty: 5 })).toBe(1);
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ stockItem: { qty: 5, is_in_stock: true } });
  });

  it("derives out-of-stock from a zero quantity, and lets an explicit flag win", async () => {
    const { double, call } = build({ [`PUT /rest/V1/products/${SKU}/stockItems/1`]: json(200, 1) });
    await call("magentorest_update_product_stock", { sku: SKU, qty: 0 });
    await call("magentorest_update_product_stock", { sku: SKU, qty: 0, is_in_stock: true });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ stockItem: { qty: 0, is_in_stock: false } });
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ stockItem: { qty: 0, is_in_stock: true } });
  });

  it("refuses a negative or non-numeric quantity before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_product_stock").invoke({ sku: SKU, qty: -1 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_update_product_stock").invoke({ sku: SKU, qty: "5" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("is an idempotent destructive update, and is sent once on a retryable failure", async () => {
    const { double, tool } = build({ [`PUT /rest/V1/products/${SKU}/stockItems/1`]: json(503, { message: "busy" }) });
    expect(tool("magentorest_update_product_stock").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    await expect(tool("magentorest_update_product_stock").invoke({ sku: SKU, qty: 5 }, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });
});

describe("magentorest_get_low_stock_products", () => {
  it("asks Magento's lowStock endpoint with ITS parameters, not searchCriteria filters", async () => {
    const { double, call } = build({ "GET /rest/V1/stockItems/lowStock": json(200, { items: [RAW_STOCK], total_count: 1 }) });
    const out = (await call("magentorest_get_low_stock_products", {})) as { items: unknown[]; total_count: number };
    const q = params(double.calls[0]?.url);
    expect(Object.fromEntries(q)).toEqual({ scopeId: "0", qty: "10", pageSize: "50", currentPage: "1" });
    expect(out.total_count).toBe(1);
  });

  it("honours a threshold, scope and page", async () => {
    const { double, call } = build({ "GET /rest/V1/stockItems/lowStock": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_get_low_stock_products", { threshold: 3, scope_id: 1, page_size: 20, current_page: 2 });
    expect(Object.fromEntries(params(double.calls[0]?.url))).toEqual({ scopeId: "1", qty: "3", pageSize: "20", currentPage: "2" });
  });

  it("projects the items", async () => {
    const { call } = build({ "GET /rest/V1/stockItems/lowStock": json(200, injectLeakProbe({ items: [RAW_STOCK], total_count: 1 })) });
    expect(JSON.stringify(await call("magentorest_get_low_stock_products", {}))).not.toContain("secret");
  });

  it("refuses a negative threshold and a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_get_low_stock_products").invoke({ threshold: -1 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_low_stock_products").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("inventory (multi-source) reads", () => {
  it("get_inventory_sources returns warehouses without street, phone, email or contact person", async () => {
    const raw = { source_code: "default", name: "Default Source", enabled: true, description: "d", country_id: "ES", region_id: 1, city: "Madrid", postcode: "28001", priority: 0, use_default_carrier_config: true, street: "1 Demo Street", phone: "000", email: "wh@demo-host.example", contact_name: "A Person" };
    const { double, call } = build({ "GET /rest/V1/inventory/sources": json(200, injectLeakProbe({ items: [raw], total_count: 1 })) });
    const out = await call("magentorest_get_inventory_sources", {});
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("50");
    const text = JSON.stringify(out);
    for (const hidden of ["1 Demo Street", "wh@demo-host.example", "A Person", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
    expect(text).toContain("default");
  });

  it("get_inventory_stocks asks for one page of 100 and keeps the sales channels", async () => {
    const raw = { stock_id: 1, name: "Default Stock", extension_attributes: { sales_channels: [{ type: "website", code: "base", extra: "x" }] } };
    const { double, call } = build({ "GET /rest/V1/inventory/stocks": json(200, injectLeakProbe({ items: [raw], total_count: 1 })) });
    const out = (await call("magentorest_get_inventory_stocks", {})) as { items: Record<string, unknown>[] };
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("100");
    expect(out.items[0]?.["extension_attributes"]).toEqual({ sales_channels: [{ type: "website", code: "base" }] });
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("get_source_items filters by SKU as data, with a bounded page", async () => {
    const { double, call } = build({ "GET /rest/V1/inventory/source-items": json(200, injectLeakProbe({ items: [{ sku: SKU, source_code: "default", quantity: 5, status: 1 }], total_count: 1 })) });
    const out = await call("magentorest_get_source_items", { sku: SKU });
    const q = params(double.calls[0]?.url);
    expect(q.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("sku");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe(SKU);
    expect(q.get("searchCriteria[pageSize]")).toBe("100");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("get_source_items keeps a SKU containing & inside its one value", async () => {
    const { double, call } = build({ "GET /rest/V1/inventory/source-items": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_get_source_items", { sku: "x&searchCriteria[pageSize]=9999" });
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("100");
  });
});

// Observed against a live 2.4.8-p5 with multi-source inventory enabled: the legacy stock item
// answers `qty: null` and every low-stock row has quantity 0, because the quantity lives in the
// per-source items. A tool that returns a null quantity without saying why invites a wrong
// conclusion, so each legacy tool names the one that has the real figure.
describe("legacy stock tools point at the per-source quantities", () => {
  it.each(["magentorest_get_product_stock", "magentorest_get_low_stock_products", "magentorest_update_product_stock"])("%s says to use get_source_items when multi-source inventory is on", (name) => {
    const description = build({}).tool(name).description;
    expect(description).toMatch(/multi-source/i);
    expect(description).toContain("magentorest_get_source_items");
  });
});

// Observed live: writing the legacy stock item's quantity to 5 made the `default` SOURCE read 5, and
// nothing else changed. With multi-source inventory on, the legacy item mirrors the default source
// only — not "nothing", and not every source.
describe("legacy stock tools say which source they mirror", () => {
  it.each(["magentorest_get_product_stock", "magentorest_get_low_stock_products", "magentorest_update_product_stock"])("%s names the default source", (name) => {
    expect(build({}).tool(name).description).toMatch(/default source/i);
  });

  it("update_product_stock no longer claims it leaves the multi-source quantities alone", () => {
    expect(build({}).tool("magentorest_update_product_stock").description).not.toMatch(/does not touch per-source/i);
  });
});
