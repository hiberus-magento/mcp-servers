// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Drives the real tools through the real client over the fetch
// double. The security cases come from the audit of the server this replaces:
// a SKU interpolated raw into the path, `sort_field` spliced into the query,
// and a product response returned wholesale.
import { StaticTokenProvider } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_BASE_URL, SYNTHETIC_MAGENTO_SKUS, SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createMagentoRestClient } from "../client/index.js";
import { createFetchDouble, json, type RouteTable } from "../testing/fetch-double.js";
import { productTools } from "./products-tools.js";
import { createToolFactory, type MagentoRestTool } from "./rest-tool.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const remedy = { domain: "magento-rest", cliCommand: "x", envVar: "MAGENTO_REST_TOKEN", configPath: "/x", reason: "t" };

function build(routes: RouteTable) {
  const double = createFetchDouble(routes);
  let clock = 0;
  const client = createMagentoRestClient({
    fetch: double.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    baseUrl: SYNTHETIC_MAGENTO_BASE_URL,
    tokenProvider: new StaticTokenProvider({ domain: "magento-rest", resolve: () => SYNTHETIC_MAGENTO_TOKEN, remedy }),
  });
  const tools = productTools(createToolFactory(() => client));
  const tool = (name: string): MagentoRestTool => {
    const found = tools.find((t) => t.name === name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    return found;
  };
  const call = async (name: string, args: unknown) => JSON.parse((await tool(name).invoke(args, {})).content[0]?.text ?? "null") as unknown;
  return { double, tools, tool, call };
}

const RAW_PRODUCT = {
  id: 7,
  sku: SKU,
  name: "Demo Tent",
  price: 99.5,
  status: 1,
  visibility: 4,
  type_id: "simple",
  attribute_set_id: 4,
  weight: 2,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-02 00:00:00",
  cost_secret: "do-not-leak",
  custom_attributes: [
    { attribute_code: "url_key", value: "demo-tent" },
    { attribute_code: "nested", value: { deep: "do-not-leak" } },
  ],
  extension_attributes: { stock_item: { qty: 5000 }, category_links: [{ category_id: "3", position: 0, extra: "do-not-leak" }] },
};

describe("productTools surface", () => {
  it("exposes the three reads and the six writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_advanced_product_search",
      "magentorest_get_product_by_sku",
      "magentorest_search_products",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual([
      "magentorest_assign_product_to_category",
      "magentorest_create_product",
      "magentorest_delete_product",
      "magentorest_remove_product_from_category",
      "magentorest_update_product",
      "magentorest_update_product_attribute",
    ]);
  });
});

describe("magentorest_get_product_by_sku", () => {
  it("requests the product and returns only the allowlisted fields", async () => {
    const { call } = build({ [`GET /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT) });
    const out = (await call("magentorest_get_product_by_sku", { sku: SKU })) as Record<string, unknown>;
    expect(out["sku"]).toBe(SKU);
    // An attribute whose VALUE is an object keeps its code but loses the value.
    expect(out["custom_attributes"]).toEqual([{ attribute_code: "url_key", value: "demo-tent" }, { attribute_code: "nested" }]);
    expect(out["extension_attributes"]).toEqual({ category_links: [{ category_id: "3", position: 0 }] });
    expect(JSON.stringify(out)).not.toContain("do-not-leak");
    expect(JSON.stringify(out)).not.toContain("5000");
  });

  it("encodes a SKU that tries to re-address the request to another endpoint", async () => {
    const { double, tool } = build({ "GET /rest/V1/products/a%2F..%2F..%2Fcustomers": json(404, { message: "no such product" }) });
    await expect(tool("magentorest_get_product_by_sku").invoke({ sku: "a/../../customers" }, {})).rejects.toMatchObject({ kind: "not-found" });
    expect(double.calls.map((c) => new URL(c.url).pathname)).toEqual(["/rest/V1/products/a%2F..%2F..%2Fcustomers"]);
  });

  it("rejects an empty or over-long SKU before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_product_by_sku").invoke({ sku: "" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_product_by_sku").invoke({ sku: "x".repeat(65) }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_search_products", () => {
  it("sends a LIKE filter on name with a bounded default page", async () => {
    const { double, call } = build({ "GET /rest/V1/products": json(200, { items: [RAW_PRODUCT], total_count: 1 }) });
    const out = (await call("magentorest_search_products", { query: "tent" })) as { items: Record<string, unknown>[]; total_count: number };
    const q = new URL(double.calls[0]?.url ?? "").searchParams;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("%tent%");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("like");
    expect(q.get("searchCriteria[pageSize]")).toBe("10");
    expect(out.total_count).toBe(1);
    expect(Object.keys(out.items[0] ?? {}).sort()).toEqual(["id", "name", "price", "sku", "status", "type_id"]);
  });

  it("keeps a query containing & inside the one value", async () => {
    const { double, call } = build({ "GET /rest/V1/products": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_products", { query: "x&searchCriteria[pageSize]=9999" });
    const q = new URL(double.calls[0]?.url ?? "").searchParams;
    expect(q.get("searchCriteria[pageSize]")).toBe("10");
  });

  it("refuses a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_search_products").invoke({ query: "x", page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_advanced_product_search", () => {
  it("passes field, value, condition and sort through as data", async () => {
    const { double, call } = build({ "GET /rest/V1/products": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_advanced_product_search", { field: "price", value: "10", condition_type: "gteq", sort_field: "price", sort_direction: "ASC", page_size: 5 });
    const q = new URL(double.calls[0]?.url ?? "").searchParams;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("price");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("gteq");
    expect(q.get("searchCriteria[sortOrders][0][field]")).toBe("price");
    expect(q.get("searchCriteria[sortOrders][0][direction]")).toBe("ASC");
    expect(q.get("searchCriteria[pageSize]")).toBe("5");
  });

  it("refuses a sort field or filter field that could break out of the key", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_advanced_product_search").invoke({ field: "sku", value: "x", sort_field: "id]&x[" }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_advanced_product_search").invoke({ field: "a&b", value: "x" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses an unknown condition type", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_advanced_product_search").invoke({ field: "sku", value: "x", condition_type: "drop" }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("product writes", () => {
  it("create_product wraps the product, puts prose in custom_attributes, and defaults the enums", async () => {
    const { double, call } = build({ "POST /rest/V1/products": json(200, RAW_PRODUCT) });
    await call("magentorest_create_product", { sku: SKU, name: "Demo Tent", price: 99.5, description: "A tent." });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({
      product: {
        sku: SKU,
        name: "Demo Tent",
        price: 99.5,
        attribute_set_id: 4,
        type_id: "simple",
        status: 1,
        visibility: 4,
        custom_attributes: [{ attribute_code: "description", value: "A tent." }],
      },
    });
  });

  it("update_product sends only the fields given", async () => {
    const { double, call } = build({ [`PUT /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT) });
    await call("magentorest_update_product", { sku: SKU, price: 10, short_description: "Short." });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ product: { price: 10, custom_attributes: [{ attribute_code: "short_description", value: "Short." }] } });
  });

  it("update_product refuses an update that changes nothing, without calling Magento", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_product").invoke({ sku: SKU }, {})).rejects.toThrow(/nothing to update/i);
    expect(double.calls).toHaveLength(0);
  });

  it("update_product_attribute writes a custom attribute through custom_attributes", async () => {
    const { double, call } = build({
      [`GET /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT),
      [`PUT /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT),
    });
    await call("magentorest_update_product_attribute", { sku: SKU, attribute_code: "url_key", value: "new-key" });
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ product: { custom_attributes: [{ attribute_code: "url_key", value: "new-key" }] } });
  });

  it("update_product_attribute writes a standard attribute at the top level", async () => {
    const { double, call } = build({
      [`GET /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT),
      [`PUT /rest/V1/products/${SKU}`]: json(200, RAW_PRODUCT),
    });
    await call("magentorest_update_product_attribute", { sku: SKU, attribute_code: "price", value: 12 });
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ product: { price: 12 } });
  });

  it.each(["sku", "id", "entity_id", "type_id"])("update_product_attribute refuses the identity attribute %s", async (attribute_code) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_product_attribute").invoke({ sku: SKU, attribute_code, value: "x" }, {})).rejects.toThrow(/identity/i);
    expect(double.calls).toHaveLength(0);
  });

  it("update_product_attribute refuses an object value, which the original accepted as z.any()", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_update_product_attribute").invoke({ sku: SKU, attribute_code: "price", value: { a: 1 } }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("delete_product returns Magento's boolean and encodes the SKU", async () => {
    const { double, call } = build({ "DELETE /rest/V1/products/a%2Fb": json(200, true) });
    expect(await call("magentorest_delete_product", { sku: "a/b" })).toBe(true);
    expect(double.calls[0]?.method).toBe("DELETE");
  });

  it("assign and remove address the category by number and the SKU by encoded segment", async () => {
    const { double, call } = build({ "POST /rest/V1/categories/3/products": json(200, true), [`DELETE /rest/V1/categories/3/products/${SKU}`]: json(200, true) });
    await call("magentorest_assign_product_to_category", { category_id: 3, sku: SKU });
    await call("magentorest_remove_product_from_category", { category_id: 3, sku: SKU });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ productLink: { sku: SKU, category_id: 3, position: 0 } });
    expect(double.calls[1]?.method).toBe("DELETE");
  });
});
