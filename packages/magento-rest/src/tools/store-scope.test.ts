// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Through `/rest/V1`, Magento runs a request as the default store
// view: a product, category or media write changes only that store view's
// values, and a CMS block or page without a store assignment is assigned to
// that one store view. The catalog writes therefore run in the `all` (global)
// scope unless the agent names a store view, and the CMS writes always run in
// `all`. Reads and writes that carry no store-scoped values keep the base URL.
import { SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { json, type RouteTable } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { categoryTools } from "./categories-tools.js";
import { cmsTools } from "./cms-tools.js";
import { mediaTools } from "./media-tools.js";
import { productTools } from "./products-tools.js";
import type { ToolFactory } from "./rest-tool.js";

const SKU = SYNTHETIC_MAGENTO_SKUS[0];
const PRODUCT = { id: 1, sku: SKU, name: "Demo", custom_attributes: [{ attribute_code: "color", value: "1" }] };
const ENTRY = { id: 5, media_type: "image", label: "a", position: 0, disabled: false, types: [], file: "/a/b.jpg" };
const BLOCK = { id: 7, identifier: "demo-block", title: "Demo", content: "<p>x</p>", active: true };
const PAGE = { id: 8, identifier: "demo-page", title: "Demo", content: "<p>x</p>", active: true };

const tools = (factory: ToolFactory) => [...productTools(factory), ...mediaTools(factory), ...categoryTools(factory), ...cmsTools(factory)];

/** Every route the cases below need, under each scope they may use. */
function routes(scope: string): RouteTable {
  const at = (method: string, path: string) => `${method} /rest/${scope}/V1${path}`;
  return {
    [at("POST", "/products")]: json(200, PRODUCT),
    [at("GET", `/products/${SKU}`)]: json(200, PRODUCT),
    [at("PUT", `/products/${SKU}`)]: json(200, PRODUCT),
    [at("POST", `/products/${SKU}/media`)]: json(200, "5"),
    [at("GET", `/products/${SKU}/media/5`)]: json(200, ENTRY),
    [at("PUT", `/products/${SKU}/media/5`)]: json(200, true),
    [at("POST", "/categories")]: json(200, { id: 9 }),
    [at("PUT", "/categories/9")]: json(200, { id: 9 }),
    [at("POST", "/cmsBlock")]: json(200, BLOCK),
    [at("GET", "/cmsBlock/7")]: json(200, BLOCK),
    [at("PUT", "/cmsBlock/7")]: json(200, BLOCK),
    [at("POST", "/cmsPage")]: json(200, PAGE),
    [at("GET", "/cmsPage/8")]: json(200, PAGE),
    [at("PUT", "/cmsPage/8")]: json(200, PAGE),
  };
}

const CATALOG_WRITES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["magentorest_create_product", { sku: SKU, name: "Demo", price: 1 }],
  ["magentorest_update_product", { sku: SKU, name: "Renamed" }],
  ["magentorest_update_product_attribute", { sku: SKU, attribute_code: "color", value: "2" }],
  ["magentorest_add_product_image", { sku: SKU, image_base64: "AAAA", image_name: "front.jpg" }],
  ["magentorest_update_product_media", { sku: SKU, entry_id: 5, label: "b" }],
  ["magentorest_create_category", { name: "Demo", parent_id: 2 }],
  ["magentorest_update_category", { category_id: 9, name: "Renamed" }],
];

const CMS_WRITES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["magentorest_create_cms_block", { identifier: "demo-block", title: "Demo", content: "<p>x</p>" }],
  ["magentorest_update_cms_block", { block_id: 7, title: "Renamed" }],
  ["magentorest_create_cms_page", { identifier: "demo-page", title: "Demo", content: "<p>x</p>" }],
  ["magentorest_update_cms_page", { page_id: 8, title: "Renamed" }],
];

const scopes = (paths: readonly string[]) => paths.map((path) => /^\/rest\/(?:([A-Za-z0-9_]+)\/)?V1\//.exec(new URL(path, "https://x").pathname)?.[1] ?? "(base)");

describe("store scope of catalog and CMS writes", () => {
  it.each(CATALOG_WRITES)("%s runs in the global scope (all) when no store_code is given", async (name, args) => {
    const harness = buildToolHarness(tools, routes("all"));
    await harness.call(name, args);
    expect(new Set(scopes(harness.paths()))).toEqual(new Set(["all"]));
  });

  it.each(CATALOG_WRITES)("%s runs in the named store view when store_code is given", async (name, args) => {
    const harness = buildToolHarness(tools, routes("demo_view"));
    await harness.call(name, { ...args, store_code: "demo_view" });
    expect(new Set(scopes(harness.paths()))).toEqual(new Set(["demo_view"]));
  });

  it.each(CATALOG_WRITES)("%s refuses a store_code that is not a store code", async (name, args) => {
    const harness = buildToolHarness(tools, routes("all"));
    await expect(harness.call(name, { ...args, store_code: "all/../V1" })).rejects.toThrow();
    expect(harness.paths()).toHaveLength(0);
  });

  it.each(CMS_WRITES)("%s always runs in the global scope (all), so the record stays on every store view", async (name, args) => {
    const harness = buildToolHarness(tools, routes("all"));
    await harness.call(name, args);
    expect(new Set(scopes(harness.paths()))).toEqual(new Set(["all"]));
    expect(harness.tool(name).inputSchema.shape).not.toHaveProperty("store_code");
  });

  it("leaves reads and unscoped writes on the base URL", async () => {
    const harness = buildToolHarness(tools, { [`GET /rest/V1/products/${SKU}`]: json(200, PRODUCT), [`DELETE /rest/V1/products/${SKU}`]: json(200, true) });
    await harness.call("magentorest_get_product_by_sku", { sku: SKU });
    await harness.call("magentorest_delete_product", { sku: SKU });
    expect(scopes(harness.paths())).toEqual(["(base)", "(base)"]);
  });

  it("create_product says how it assigns websites, and sends website_ids only when given", async () => {
    const harness = buildToolHarness(tools, routes("all"));
    expect(harness.tool("magentorest_create_product").description).toMatch(/every website/);
    await harness.call("magentorest_create_product", { sku: SKU, name: "Demo", price: 1 });
    await harness.call("magentorest_create_product", { sku: SKU, name: "Demo", price: 1, website_ids: [1, 2] });
    const bodies = harness.double.calls.map((call) => JSON.parse(call.body ?? "{}") as { product: { extension_attributes?: unknown } });
    expect(bodies[0]?.product.extension_attributes).toBeUndefined();
    expect(bodies[1]?.product.extension_attributes).toEqual({ website_ids: [1, 2] });
  });

  it("a CMS block update says it resets the store assignment; a page update says it keeps it", () => {
    const harness = buildToolHarness(tools, {});
    expect(harness.tool("magentorest_update_cms_block").description).toMatch(/resets/);
    expect(harness.tool("magentorest_update_cms_page").description).toMatch(/keeps its store assignment/);
  });
});
