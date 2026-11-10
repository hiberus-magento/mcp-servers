// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `attributes.js`. Attribute codes go into
// URL paths, so each is a closed shape (the original interpolated them raw);
// everything else is the usual: encoded paths, validated criteria, bounded
// pages, allowlisted results.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { attributeTools } from "./attributes-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(attributeTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_ATTRIBUTE = {
  attribute_id: 93,
  attribute_code: "color",
  frontend_input: "select",
  entity_type_id: "4",
  backend_type: "int",
  default_frontend_label: "Color",
  scope: "global",
  is_required: false,
  is_user_defined: true,
  is_unique: "0",
  is_searchable: "1",
  is_filterable: "1",
  is_filterable_in_search: true,
  is_comparable: "1",
  is_visible_on_front: "0",
  used_in_product_listing: "0",
  used_for_sort_by: "0",
  apply_to: [],
  options: [{ label: "Red", value: "5", internal: "x" }],
  frontend_labels: [{ store_id: 1, label: "Colour", hidden: "x" }],
  validation_rules: [{ key: "k", value: "v" }],
};

describe("attributeTools surface", () => {
  it("exposes five reads and one write, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_attribute_options",
      "magentorest_get_attribute_set_attributes",
      "magentorest_get_attribute_sets",
      "magentorest_get_product_attribute",
      "magentorest_search_product_attributes",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name)).toEqual(["magentorest_add_attribute_option"]);
  });
});

describe("magentorest_get_product_attribute", () => {
  it("reads one attribute and projects it, keeping options and labels but not validation rules", async () => {
    const { call } = build({ "GET /rest/V1/products/attributes/color": json(200, injectLeakProbe(RAW_ATTRIBUTE)) });
    const out = (await call("magentorest_get_product_attribute", { attribute_code: "color" })) as Record<string, unknown>;
    expect(out["attribute_code"]).toBe("color");
    expect(out["options"]).toEqual([{ label: "Red", value: "5" }]);
    expect(out["frontend_labels"]).toEqual([{ store_id: 1, label: "Colour" }]);
    expect(out).not.toHaveProperty("validation_rules");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each(["Color", "a b", "../orders", "a/b", "", "1abc", "x".repeat(61)])("refuses the attribute code %j before any request", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_product_attribute").invoke({ attribute_code: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_search_product_attributes", () => {
  it("puts each filter in its own group (AND), maps flags to 1/0, and bounds the page at 50", async () => {
    const { double, call } = build({ "GET /rest/V1/products/attributes": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_product_attributes", { attribute_code: "col", frontend_input: "select", is_searchable: true, is_filterable: false });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["attribute_code", "%col%", "like"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["frontend_input", "select", "eq"]);
    expect([f(2, "field"), f(2, "value")]).toEqual(["is_searchable", "1"]);
    expect([f(3, "field"), f(3, "value")]).toEqual(["is_filterable", "0"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("50");
  });

  it("returns summaries only", async () => {
    const { call } = build({ "GET /rest/V1/products/attributes": json(200, injectLeakProbe({ items: [RAW_ATTRIBUTE], total_count: 1 })) });
    const out = (await call("magentorest_search_product_attributes", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(out.items[0]).not.toHaveProperty("options");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each([{ attribute_code: "Bad Code" }, { frontend_input: "SELECT" }, { frontend_input: "a&b" }, { page_size: 101 }])("refuses %j", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_search_product_attributes").invoke(bad, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_get_attribute_options", () => {
  it("returns the options as label/value pairs", async () => {
    const { call } = build({ "GET /rest/V1/products/attributes/color/options": json(200, injectLeakProbe([{ label: "Red", value: "5", is_default: true }, { label: " ", value: "" }])) });
    const out = (await call("magentorest_get_attribute_options", { attribute_code: "color" })) as Record<string, unknown>[];
    expect(out[0]).toEqual({ label: "Red", value: "5" });
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("returns an empty list when the response is not a list", async () => {
    const { call } = build({ "GET /rest/V1/products/attributes/color/options": json(200, {}) });
    expect(await call("magentorest_get_attribute_options", { attribute_code: "color" })).toEqual([]);
  });
});

describe("attribute sets", () => {
  it("get_attribute_sets lists the sets with a bounded page of 50", async () => {
    const { double, call } = build({ "GET /rest/V1/products/attribute-sets/sets/list": json(200, injectLeakProbe({ items: [{ attribute_set_id: 4, attribute_set_name: "Default", sort_order: 0, entity_type_id: 4 }], total_count: 1 })) });
    const out = (await call("magentorest_get_attribute_sets", {})) as { items: unknown[]; total_count: number };
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("50");
    expect(out.total_count).toBe(1);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("get_attribute_set_attributes lists the attributes of one set as summaries", async () => {
    const { call } = build({ "GET /rest/V1/products/attribute-sets/4/attributes": json(200, injectLeakProbe([RAW_ATTRIBUTE])) });
    const out = (await call("magentorest_get_attribute_set_attributes", { attribute_set_id: 4 })) as Record<string, unknown>[];
    expect(out[0]?.["attribute_code"]).toBe("color");
    expect(out[0]).not.toHaveProperty("options");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("refuses a non-positive set ID", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_get_attribute_set_attributes").invoke({ attribute_set_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_add_attribute_option", () => {
  it("POSTs a non-default option with sort order 0 by default", async () => {
    const { double, call } = build({ "POST /rest/V1/products/attributes/color/options": { status: 200, body: '"id_9"' } });
    expect(await call("magentorest_add_attribute_option", { attribute_code: "color", label: "Teal" })).toBe("id_9");
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ option: { label: "Teal", sort_order: 0, is_default: false } });
  });

  it("honours an explicit sort order", async () => {
    const { double, call } = build({ "POST /rest/V1/products/attributes/color/options": { status: 200, body: '"id_9"' } });
    await call("magentorest_add_attribute_option", { attribute_code: "color", label: "Teal", sort_order: 3 });
    expect(JSON.parse(double.calls[0]?.body ?? "{}").option.sort_order).toBe(3);
  });

  it.each([{ label: "" }, { label: "x".repeat(256) }, { sort_order: -1 }, { attribute_code: "../x" }, { is_default: true }])("refuses %j before any request", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_add_attribute_option").invoke({ attribute_code: "color", label: "Teal", ...bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("only creates (not destructive, not idempotent) and is sent once on a retryable failure", async () => {
    const { double, tool } = build({ "POST /rest/V1/products/attributes/color/options": json(503, { message: "busy" }) });
    expect(tool("magentorest_add_attribute_option").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    await expect(tool("magentorest_add_attribute_option").invoke({ attribute_code: "color", label: "Teal" }, {})).rejects.toMatchObject({ kind: "server" });
    expect(double.calls).toHaveLength(1);
  });
});
