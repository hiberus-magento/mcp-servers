// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `categories.js`. Beyond the usual
// path / criteria / projection cases, the category TREE is recursive, which a
// fixed allowlist cannot describe, so `magentorest_get_category_tree` returns
// it FLATTENED (id, parent_id, level) with a node cap and a truncation flag.
import { SYNTHETIC_MAGENTO_SKUS } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { json } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { categoryTools } from "./categories-tools.js";

const [SKU] = SYNTHETIC_MAGENTO_SKUS;
const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(categoryTools, routes);

const RAW_CATEGORY = {
  id: 5,
  parent_id: 2,
  name: "Tents",
  is_active: true,
  position: 1,
  level: 2,
  product_count: 12,
  children: "6,7",
  path: "1/2/5",
  include_in_menu: true,
  available_sort_by: ["name", "price"],
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-02 00:00:00",
  custom_attributes: [{ attribute_code: "url_key", value: "tents" }],
};

describe("categoryTools surface", () => {
  it("exposes the four reads and the four writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_category_by_id",
      "magentorest_get_category_tree",
      "magentorest_get_products_in_category",
      "magentorest_list_categories",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual([
      "magentorest_create_category",
      "magentorest_delete_category",
      "magentorest_move_category",
      "magentorest_update_category",
    ]);
  });
});

describe("magentorest_get_category_tree", () => {
  const tree = {
    id: 1,
    parent_id: 0,
    name: "Root",
    is_active: true,
    position: 0,
    level: 0,
    product_count: 0,
    children_data: [
      {
        id: 2,
        parent_id: 1,
        name: "Default",
        is_active: true,
        position: 1,
        level: 1,
        product_count: 3,
        children_data: [{ id: 5, parent_id: 2, name: "Tents", is_active: true, position: 1, level: 2, product_count: 12, children_data: [] }],
      },
    ],
  };

  it("flattens the tree into nodes carrying parent_id and level, with no children_data", async () => {
    const { call, paths } = build({ "GET /rest/V1/categories?rootCategoryId=1": json(200, injectLeakProbe(tree)) });
    const out = (await call("magentorest_get_category_tree", {})) as { items: Record<string, unknown>[]; total_count: number; truncated: boolean };
    expect(out.items.map((n) => [n["id"], n["parent_id"], n["level"]])).toEqual([[1, 0, 0], [2, 1, 1], [5, 2, 2]]);
    expect(out.total_count).toBe(3);
    expect(out.truncated).toBe(false);
    expect(JSON.stringify(out)).not.toContain("children_data");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(paths()).toEqual(["/rest/V1/categories?rootCategoryId=1"]);
  });

  it("passes the root category through as a number", async () => {
    const { call, paths } = build({ "GET /rest/V1/categories?rootCategoryId=2": json(200, tree) });
    await call("magentorest_get_category_tree", { root_category_id: 2 });
    expect(paths()).toEqual(["/rest/V1/categories?rootCategoryId=2"]);
  });

  it("stops at 500 nodes and says so, instead of returning a catalog-sized tree", async () => {
    const wide = { id: 1, parent_id: 0, name: "Root", is_active: true, position: 0, level: 0, product_count: 0, children_data: Array.from({ length: 700 }, (_, i) => ({ id: i + 2, parent_id: 1, name: `C${i}`, is_active: true, position: i, level: 1, product_count: 0, children_data: [] })) };
    const { call } = build({ "GET /rest/V1/categories?rootCategoryId=1": json(200, wide) });
    const out = (await call("magentorest_get_category_tree", {})) as { items: unknown[]; total_count: number; truncated: boolean };
    expect(out.items).toHaveLength(500);
    expect(out.truncated).toBe(true);
    expect(out.total_count).toBe(701);
  });

  it("refuses a non-positive or non-integer root", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_get_category_tree").invoke({ root_category_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_category_tree").invoke({ root_category_id: "1" }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_category_by_id", () => {
  it("reads one category and projects it", async () => {
    const { call } = build({ "GET /rest/V1/categories/5": json(200, injectLeakProbe(RAW_CATEGORY)) });
    const out = (await call("magentorest_get_category_by_id", { category_id: 5 })) as Record<string, unknown>;
    expect(out["name"]).toBe("Tents");
    expect(out["available_sort_by"]).toEqual(["name", "price"]);
    expect(out["custom_attributes"]).toEqual([{ attribute_code: "url_key", value: "tents" }]);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });
});

describe("magentorest_list_categories", () => {
  const q = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

  it("puts each filter in its own group (AND) and bounds the page", async () => {
    const { double, call } = build({ "GET /rest/V1/categories/list": json(200, { items: [injectLeakProbe(RAW_CATEGORY)], total_count: 1 }) });
    const out = (await call("magentorest_list_categories", { parent_id: 2, name: "tent", is_active: true })) as { items: unknown[]; total_count: number };
    const params = q(double.calls[0]?.url);
    expect(params.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("parent_id");
    expect(params.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("2");
    expect(params.get("searchCriteria[filter_groups][1][filters][0][value]")).toBe("%tent%");
    expect(params.get("searchCriteria[filter_groups][1][filters][0][condition_type]")).toBe("like");
    expect(params.get("searchCriteria[filter_groups][2][filters][0][field]")).toBe("is_active");
    expect(params.get("searchCriteria[filter_groups][2][filters][0][value]")).toBe("1");
    expect(params.get("searchCriteria[pageSize]")).toBe("20");
    expect(out.total_count).toBe(1);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("with no filter is still one bounded page, and false maps to 0", async () => {
    const { double, call } = build({ "GET /rest/V1/categories/list": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_list_categories", {});
    expect(q(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("20");
    await call("magentorest_list_categories", { is_active: false });
    expect(q(double.calls[1]?.url).get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("0");
  });

  it("refuses a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_list_categories").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_products_in_category", () => {
  it("filters products by category and projects them to summaries", async () => {
    const { double, call } = build({ "GET /rest/V1/products": json(200, injectLeakProbe({ items: [{ id: 7, sku: SKU, name: "Tent", price: 9, status: 1, type_id: "simple", cost: 1 }], total_count: 1 })) });
    const out = (await call("magentorest_get_products_in_category", { category_id: 5 })) as { items: Record<string, unknown>[] };
    const params = new URL(double.calls[0]?.url ?? "").searchParams;
    expect(params.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("category_id");
    expect(params.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("5");
    expect(params.get("searchCriteria[pageSize]")).toBe("20");
    expect(Object.keys(out.items[0] ?? {}).sort()).toEqual(["id", "name", "price", "sku", "status", "type_id"]);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });
});

describe("category writes", () => {
  it("create_category wraps the category, defaults the flags, and puts prose in custom_attributes", async () => {
    const { double, call } = build({ "POST /rest/V1/categories": json(200, RAW_CATEGORY) });
    await call("magentorest_create_category", { name: "Tents", parent_id: 2, description: "All tents.", url_key: "tents" });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({
      category: {
        name: "Tents",
        parent_id: 2,
        is_active: true,
        include_in_menu: true,
        custom_attributes: [
          { attribute_code: "description", value: "All tents." },
          { attribute_code: "url_key", value: "tents" },
        ],
      },
    });
  });

  it("update_category sends only the fields given", async () => {
    const { double, call } = build({ "PUT /rest/V1/categories/5": json(200, RAW_CATEGORY) });
    await call("magentorest_update_category", { category_id: 5, is_active: false, position: 3, description: "New." });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ category: { is_active: false, position: 3, custom_attributes: [{ attribute_code: "description", value: "New." }] } });
  });

  it("update_category refuses an update that changes nothing, without calling Magento", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_category").invoke({ category_id: 5 }, {})).rejects.toThrow(/nothing to update/i);
    expect(double.calls).toHaveLength(0);
  });

  it("delete_category returns Magento's boolean", async () => {
    const { double, call } = build({ "DELETE /rest/V1/categories/5": json(200, true) });
    expect(await call("magentorest_delete_category", { category_id: 5 })).toBe(true);
    expect(double.calls[0]?.method).toBe("DELETE");
  });

  it("move_category sends parentId and, only when given, afterId", async () => {
    const { double, call } = build({ "PUT /rest/V1/categories/5/move": json(200, true) });
    await call("magentorest_move_category", { category_id: 5, parent_id: 3 });
    await call("magentorest_move_category", { category_id: 5, parent_id: 3, after_id: 9 });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ parentId: 3 });
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ parentId: 3, afterId: 9 });
  });

  it("marks the destructive ones destructive and the create one not", () => {
    const { tool } = build({});
    expect(tool("magentorest_create_category").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tool("magentorest_delete_category").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool("magentorest_move_category").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});
