// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Customer personal data stays out of every result unless the operator turns it on (Kora contract R-7): an order
// status read must not put a shopper's email or name into a model's context. These go through the assembled tool
// set, exactly as the server builds it.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID, SYNTHETIC_MAGENTO_SKUS, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createMagentoRestClient } from "../client/index.js";
import { createFetchDouble, json } from "../testing/fetch-double.js";
import { withoutCustomerData } from "./customer-data.js";
import { createMagentoRestTools, type CreateToolsOptions } from "./index.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const EMAIL = SYNTHETIC_MAGENTO_CUSTOMER_EMAIL;

const ORDER = {
  entity_id: 5,
  increment_id: SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID,
  status: "processing",
  state: "processing",
  customer_id: 3,
  customer_is_guest: false,
  customer_email: EMAIL,
  customer_firstname: "Demo",
  customer_lastname: "Shopper",
  grand_total: 10,
  items: [{ sku: SKU, name: "Demo tent", qty_ordered: 1 }],
};
const CART = { id: 9, is_active: true, items_count: 1, customer: { id: 3, email: EMAIL, firstname: "Demo", lastname: "Shopper", group_id: 1 } };
const CUSTOMER = { id: 3, email: EMAIL, firstname: "Demo", lastname: "Shopper", group_id: 1, addresses: [{ id: 4, customer_id: 3, country_id: "ES", city: "Demo City", postcode: "00000" }] };
const SOURCES = { items: [{ source_code: "demo_wh", name: "Demo warehouse", city: "Demo City", postcode: "00000" }], total_count: 1 };

function tools(options: Partial<CreateToolsOptions> = {}) {
  const double = createFetchDouble({
    "GET /rest/V1/orders/5": json(200, ORDER),
    "GET /rest/V1/carts/9": json(200, CART),
    "GET /rest/V1/customers/3": json(200, CUSTOMER),
    "GET /rest/V1/inventory/sources": json(200, SOURCES),
  });
  const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };
  const client = createMagentoRestClient({
    fetch: double.fetch,
    now: () => 0,
    sleep: async () => {},
    baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
    tokenProvider: new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy }),
  });
  const set = createMagentoRestTools({ getRuntime: () => ({ client }), writesEnabled: false, ...options });
  return async (name: string, args: unknown): Promise<unknown> => {
    const tool = set.find((t) => t.name === name);
    if (tool === undefined) throw new Error(`no tool named ${name}`);
    return (await tool.invoke(args, {})).structuredContent?.["result"];
  };
}

describe("customer data, off by default", () => {
  it("an order keeps its number, status, totals and lines, but not who placed it", async () => {
    const order = (await tools()("magentorest_get_order_by_id", { order_id: 5 })) as Record<string, unknown>;
    expect(order).toMatchObject({ entity_id: 5, increment_id: SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID, status: "processing", grand_total: 10, customer_is_guest: false });
    for (const field of ["customer_id", "customer_email", "customer_firstname", "customer_lastname"]) {
      expect(order).not.toHaveProperty(field);
    }
    expect(JSON.stringify(order)).not.toContain(EMAIL);
  });

  it("a cart keeps its contents but not the customer it belongs to", async () => {
    const cart = (await tools()("magentorest_get_cart_by_id", { cart_id: 9 })) as Record<string, unknown>;
    expect(cart).toMatchObject({ id: 9, items_count: 1 });
    expect(cart).not.toHaveProperty("customer");
  });

  it("a customer read returns no name or email, and an address no city or postcode", async () => {
    const call = tools();
    const customer = (await call("magentorest_get_customer_by_id", { customer_id: 3 })) as Record<string, unknown>;
    expect(customer).toMatchObject({ id: 3, group_id: 1 });
    expect(JSON.stringify(customer)).not.toMatch(/Demo|Shopper|demo-host/);
    const addresses = (await call("magentorest_get_customer_addresses", { customer_id: 3 })) as readonly Record<string, unknown>[];
    expect(addresses).toEqual([{ id: 4, country_id: "ES" }]);
  });

  it("a warehouse keeps its city and postcode: a business address is not customer data", async () => {
    const sources = (await tools()("magentorest_get_inventory_sources", {})) as { items: readonly Record<string, unknown>[] };
    expect(sources.items[0]).toMatchObject({ source_code: "demo_wh", city: "Demo City", postcode: "00000" });
  });

  it("a field configuration cannot add a customer field back while customer data is off", async () => {
    const order = (await tools({ fieldConfig: { order: { add: ["customer_dob"] } } })("magentorest_get_order_by_id", { order_id: 5 })) as Record<string, unknown>;
    expect(order).not.toHaveProperty("customer_email");
    expect(order).not.toHaveProperty("customer_dob");
  });
});

describe("customer data, turned on", () => {
  it("returns the fields the shipped lists name, as before", async () => {
    const call = tools({ customerData: true });
    expect(await call("magentorest_get_order_by_id", { order_id: 5 })).toMatchObject({ customer_id: 3, customer_email: EMAIL, customer_firstname: "Demo", customer_lastname: "Shopper" });
    expect(await call("magentorest_get_cart_by_id", { cart_id: 9 })).toMatchObject({ customer: { id: 3, email: EMAIL } });
    expect(await call("magentorest_get_customer_addresses", { customer_id: 3 })).toEqual([{ id: 4, customer_id: 3, country_id: "ES", city: "Demo City", postcode: "00000" }]);
  });
});

describe("withoutCustomerData", () => {
  it("drops personal fields at any depth and keeps everything else in order", () => {
    expect(withoutCustomerData(["id", "email", "customer_is_guest", ["customer", ["id", "email"]], ["items", ["sku", "firstname"]]])).toEqual(["id", "customer_is_guest", ["items", ["sku"]]]);
  });
});
