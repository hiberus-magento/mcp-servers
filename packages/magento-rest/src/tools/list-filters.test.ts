// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Typed `filters` and `sort` on the searchCriteria list tools (Kora asked for them): a closed field list per tool,
// the client's condition list, AND between entries, at most ten. What the field lists must never hold is a column
// that identifies a customer: a host cannot see enum values, so this package is the only place that keeps them out.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { json } from "../testing/fetch-double.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { attributeTools } from "./attributes-tools.js";
import { cartTools } from "./carts-tools.js";
import { categoryTools } from "./categories-tools.js";
import { cmsTools } from "./cms-tools.js";
import { isPersonalField } from "./customer-data.js";
import { customerTools } from "./customers-tools.js";
import { allMagentoRestTools } from "./index.js";
import { orderTools } from "./orders-tools.js";
import { productTools } from "./products-tools.js";
import { promotionTools } from "./promotions-tools.js";
import type { ToolFactory } from "./rest-tool.js";
import { salesDocumentTools } from "./sales-documents-tools.js";
import { stockTools } from "./stock-tools.js";
import { taxTools } from "./tax-tools.js";
import { genericFilterGroups, genericSort, listInputs, MAX_LIST_FILTERS } from "./list-filters.js";

const schema = z.object(listInputs(["entity_id", "status", "created_at"])).strict();

describe("listInputs", () => {
  it("accepts filters on the listed fields with any client condition, and a sort on the same fields", () => {
    const parsed = schema.parse({
      filters: [
        { field: "status", value: "pending" },
        { field: "created_at", condition: "gteq", value: "2026-01-01" },
        { field: "entity_id", condition: "in", value: [1, 2, 3] },
        { field: "status", condition: "notnull" },
      ],
      sort: { field: "created_at", direction: "ASC" },
    });
    expect(parsed.filters).toHaveLength(4);
    expect(parsed.sort).toEqual({ field: "created_at", direction: "ASC" });
  });

  it("refuses a field that is not on the tool's list, in a filter or in the sort", () => {
    expect(schema.safeParse({ filters: [{ field: "customer_email", value: "x" }] }).success).toBe(false);
    expect(schema.safeParse({ sort: { field: "customer_email" } }).success).toBe(false);
  });

  it("refuses more than the cap of filters", () => {
    const filters = Array.from({ length: MAX_LIST_FILTERS + 1 }, () => ({ field: "status", value: "pending" }));
    expect(MAX_LIST_FILTERS).toBe(10);
    expect(schema.safeParse({ filters }).success).toBe(false);
    expect(schema.safeParse({ filters: filters.slice(1) }).success).toBe(true);
  });

  it("asks in and nin for an array, the others for one value, and null and notnull for none", () => {
    const issueAt = (input: unknown) => {
      const parsed = schema.safeParse(input);
      return parsed.success ? undefined : parsed.error.issues[0]?.path.join(".");
    };
    expect(issueAt({ filters: [{ field: "status", condition: "in", value: "pending" }] })).toBe("filters.0.value");
    expect(issueAt({ filters: [{ field: "status", value: ["pending"] }] })).toBe("filters.0.value");
    expect(issueAt({ filters: [{ field: "status", condition: "eq" }] })).toBe("filters.0.value");
    expect(issueAt({ filters: [{ field: "status", condition: "null", value: "x" }] })).toBe("filters.0.value");
    expect(issueAt({ filters: [{ field: "status", condition: "in", value: ["a,b"] }] })).toBe("filters.0.value.0");
  });

  it("refuses an unknown condition, an unknown key and a sort direction other than ASC or DESC", () => {
    expect(schema.safeParse({ filters: [{ field: "status", condition: "regexp", value: "x" }] }).success).toBe(false);
    expect(schema.safeParse({ filters: [{ field: "status", value: "x", path: "/x" }] }).success).toBe(false);
    expect(schema.safeParse({ sort: { field: "status", direction: "UP" } }).success).toBe(false);
  });
});

describe("genericFilterGroups and genericSort", () => {
  it("puts every filter in its own group (AND), with eq by default, booleans as 1 and 0, arrays comma-joined", () => {
    expect(
      genericFilterGroups([
        { field: "status", value: "pending" },
        { field: "is_active", value: true },
        { field: "entity_id", condition: "in", value: [1, 2] },
        { field: "status", condition: "null" },
      ]),
    ).toEqual([
      [{ field: "status", value: "pending", conditionType: "eq" }],
      [{ field: "is_active", value: 1, conditionType: "eq" }],
      [{ field: "entity_id", value: "1,2", conditionType: "in" }],
      [{ field: "status", value: 1, conditionType: "null" }],
    ]);
    expect(genericFilterGroups(undefined)).toEqual([]);
  });

  it("sorts descending unless told otherwise, and falls back to the tool's own order without a sort", () => {
    expect(genericSort({ field: "created_at" }, undefined)).toEqual({ field: "created_at", direction: "DESC" });
    expect(genericSort({ field: "created_at", direction: "ASC" }, { field: "entity_id", direction: "DESC" })).toEqual({ field: "created_at", direction: "ASC" });
    expect(genericSort(undefined, { field: "entity_id", direction: "DESC" })).toEqual({ field: "entity_id", direction: "DESC" });
    expect(genericSort(undefined, undefined)).toBeUndefined();
  });
});

type JsonSchema = { readonly [key: string]: unknown };

/** Every enum reached through a property named `field` or `sort_field`, at any depth. */
function fieldEnums(node: unknown, found: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    node.forEach((child) => fieldEnums(child, found));
  } else if (node !== null && typeof node === "object") {
    const properties = (node as JsonSchema)["properties"];
    if (properties !== null && typeof properties === "object") {
      for (const [name, child] of Object.entries(properties as JsonSchema)) {
        const values = (child as JsonSchema)["enum"];
        if ((name === "field" || name === "sort_field") && Array.isArray(values)) found.push(values as string[]);
      }
    }
    Object.values(node as JsonSchema).forEach((child) => fieldEnums(child, found));
  }
  return found;
}

const FILTERED_TOOLS = [
  "magentorest_search_products",
  "magentorest_advanced_product_search",
  "magentorest_get_products_in_category",
  "magentorest_list_categories",
  "magentorest_get_customer_groups",
  "magentorest_search_orders",
  "magentorest_list_orders",
  "magentorest_search_invoices",
  "magentorest_search_shipments",
  "magentorest_search_creditmemos",
  "magentorest_search_carts",
  "magentorest_list_carts",
  "magentorest_get_abandoned_carts",
  "magentorest_search_cms_blocks",
  "magentorest_search_cms_pages",
  "magentorest_search_product_attributes",
  "magentorest_get_attribute_sets",
  "magentorest_get_inventory_sources",
  "magentorest_get_inventory_stocks",
  "magentorest_get_source_items",
  "magentorest_get_sales_rules",
  "magentorest_search_coupons",
  "magentorest_get_tax_rates",
  "magentorest_get_tax_rules",
  "magentorest_get_tax_classes",
];

describe("the list tools' field lists", () => {
  const tools = allMagentoRestTools();
  const jsonSchemaOf = (name: string) => z.toJSONSchema(tools.find((t) => t.name === name)?.inputSchema ?? z.object({}));

  it("every searchCriteria list tool takes filters and sort", () => {
    for (const name of FILTERED_TOOLS) {
      const properties = jsonSchemaOf(name).properties ?? {};
      expect(Object.keys(properties), name).toEqual(expect.arrayContaining(["filters", "sort"]));
    }
  });

  it("no tool's filter or sort field list holds a column that identifies a customer", () => {
    const leaks: string[] = [];
    let walked = 0;
    for (const tool of tools) {
      for (const values of fieldEnums(z.toJSONSchema(tool.inputSchema))) {
        walked += 1;
        for (const value of values) if (isPersonalField(value)) leaks.push(`${tool.name}: ${value}`);
      }
    }
    expect(walked).toBeGreaterThanOrEqual(FILTERED_TOOLS.length * 2);
    expect(leaks).toEqual([]);
  });

  it("only advanced_product_search names a field in free text, and only on products, which hold no customer column", () => {
    const freeText = tools.filter((tool) => {
      const properties = (z.toJSONSchema(tool.inputSchema).properties ?? {}) as Record<string, { type?: string; enum?: unknown }>;
      return ["field", "sort_field"].some((name) => properties[name]?.type === "string" && properties[name]?.enum === undefined);
    });
    expect(freeText.map((tool) => tool.name)).toEqual(["magentorest_advanced_product_search"]);
  });

  it("the denylist the walk checks against does hold the customer columns", () => {
    for (const name of ["customer_email", "customer_id", "customer_firstname", "customer_lastname", "email", "telephone", "remote_ip"]) expect(isPersonalField(name), name).toBe(true);
    expect(isPersonalField("status")).toBe(false);
  });
});

const EMPTY_LIST = json(200, { items: [], total_count: 0 });
const LIST_PATHS = ["/products", "/categories/list", "/customerGroups/search", "/orders", "/invoices", "/shipments", "/creditmemos", "/carts/search", "/cmsBlock/search", "/cmsPage/search", "/products/attributes", "/products/attribute-sets/sets/list", "/inventory/sources", "/inventory/stocks", "/inventory/source-items", "/salesRules/search", "/coupons/search", "/taxRates/search", "/taxRules/search", "/taxClasses/search"];
const everyListModule = (factory: ToolFactory) =>
  [productTools, categoryTools, customerTools, orderTools, salesDocumentTools, cartTools, cmsTools, attributeTools, stockTools, promotionTools, taxTools].flatMap((make) => make(factory));
const harness = () => buildToolHarness(everyListModule, Object.fromEntries(LIST_PATHS.map((path) => [`GET /rest/V1${path}`, EMPTY_LIST])));

/** The inputs a tool needs before it can run at all. */
const REQUIRED: Readonly<Record<string, Record<string, unknown>>> = {
  magentorest_search_products: { query: "tent" },
  magentorest_advanced_product_search: { field: "sku", value: "DEMO-TENT-001" },
  magentorest_get_products_in_category: { category_id: 3 },
  magentorest_get_source_items: { sku: "DEMO-TENT-001" },
};

describe("filters and sort on the wire", () => {
  const groupsOf = (url: string | undefined) => {
    const query = new URL(url ?? "").searchParams;
    const groups: Record<string, string>[] = [];
    for (let group = 0; query.has(`searchCriteria[filter_groups][${group}][filters][0][field]`); group += 1) {
      const at = (key: string) => query.get(`searchCriteria[filter_groups][${group}][filters][0][${key}]`) ?? "";
      groups.push({ field: at("field"), value: at("value"), condition: at("condition_type") });
    }
    return { groups, sort: [query.get("searchCriteria[sortOrders][0][field]"), query.get("searchCriteria[sortOrders][0][direction]")] };
  };

  it.each(FILTERED_TOOLS)("%s sends each generic filter as its own AND group, after its own, and the sort", async (name) => {
    const { double, call, tool } = harness();
    const fields = ((z.toJSONSchema(tool(name).inputSchema).properties?.["sort"] as { properties: { field: { enum: string[] } } }).properties.field.enum);
    const [first, second] = [fields[0] ?? "", fields[1] ?? fields[0] ?? ""];
    await call(name, { ...REQUIRED[name], filters: [{ field: first, value: "7" }, { field: second, condition: "in", value: ["a", "b"] }], sort: { field: second, direction: "ASC" } });
    const { groups, sort } = groupsOf(double.calls[0]?.url);
    expect(groups.slice(-2)).toEqual([
      { field: first, value: "7", condition: "eq" },
      { field: second, value: "a,b", condition: "in" },
    ]);
    expect(sort).toEqual([second, "ASC"]);
  });

  it.each([
    ["magentorest_search_orders", { status: "pending" }, { field: "status", value: "complete" }],
    ["magentorest_list_orders", { date_from: "2026-01-01" }, { field: "created_at", condition: "lt", value: "2025-12-31" }],
    ["magentorest_list_carts", { is_active: true }, { field: "is_active", value: false }],
    ["magentorest_list_categories", { parent_id: 2 }, { field: "parent_id", value: 5 }],
    ["magentorest_search_cms_pages", { identifier: "home" }, { field: "identifier", value: "about" }],
    ["magentorest_get_source_items", { sku: "DEMO-TENT-001" }, { field: "sku", value: "DEMO-TENT-002" }],
    ["magentorest_get_tax_classes", { tax_class_type: "PRODUCT" }, { field: "class_type", value: "CUSTOMER" }],
  ] as const)("%s ANDs a bespoke input and a generic filter on the same column: both are sent", async (name, bespoke, generic) => {
    const { double, call } = harness();
    await call(name, { ...bespoke, filters: [generic] });
    const { groups } = groupsOf(double.calls[0]?.url);
    const column = groups.filter((group) => group.field === generic.field);
    expect(column.length, JSON.stringify(groups)).toBeGreaterThanOrEqual(2);
    expect(groups.at(-1)).toMatchObject({ field: generic.field, condition: "condition" in generic ? generic.condition : "eq" });
  });

  it("keeps a tool's own order without a sort, and defaults a sort without direction to DESC", async () => {
    const { double, call } = harness();
    await call("magentorest_get_abandoned_carts", {});
    await call("magentorest_get_tax_rates", { sort: { field: "rate" } });
    expect(groupsOf(double.calls[0]?.url).sort).toEqual(["updated_at", "DESC"]);
    expect(groupsOf(double.calls[1]?.url).sort).toEqual(["rate", "DESC"]);
  });
});
