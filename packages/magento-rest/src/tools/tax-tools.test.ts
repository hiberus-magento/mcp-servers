// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `tax.js`: three reads. The tax class
// type was free text; it is now the two values Magento defines.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { taxTools } from "./tax-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(taxTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

describe("taxTools surface", () => {
  it("exposes three reads and no write", () => {
    const { tools } = build({});
    expect(tools.map((t) => t.name).sort()).toEqual(["magentorest_get_tax_classes", "magentorest_get_tax_rates", "magentorest_get_tax_rules"]);
    expect(tools.every((t) => t.access === "read")).toBe(true);
  });
});

describe.each([
  ["magentorest_get_tax_rates", "/taxRates/search", { id: 1, code: "ES-VAT", rate: 21, tax_country_id: "ES", tax_region_id: 0, tax_postcode: "*", zip_is_range: null, titles: [{ store_id: 0, title: "x" }] }, "ES-VAT", "titles"],
  ["magentorest_get_tax_rules", "/taxRules/search", { id: 2, code: "Retail", priority: 0, position: 0, calculate_subtotal: false, customer_tax_class_ids: [3], product_tax_class_ids: [2], tax_rate_ids: [1], extension_attributes: { x: 1 } }, "Retail", "extension_attributes"],
] as const)("%s", (name, path, raw, expected, hidden) => {
  it("lists with a bounded default page of 100, projected", async () => {
    const { double, call } = build({ [`GET /rest/V1${path}`]: json(200, injectLeakProbe({ items: [raw], total_count: 1 })) });
    const out = (await call(name, {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("100");
    expect(JSON.stringify(out)).toContain(expected);
    expect(JSON.stringify(out)).not.toContain(hidden);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(out.total_count).toBe(1);
  });

  it("honours the page and refuses a page size above 100", async () => {
    const { double, call, tool } = build({ [`GET /rest/V1${path}`]: json(200, { items: [], total_count: 0 }) });
    await call(name, { page_size: 10, current_page: 2 });
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("10");
    expect(params(double.calls[0]?.url).get("searchCriteria[currentPage]")).toBe("2");
    await expect(tool(name).invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_tax_classes", () => {
  const RAW = { class_id: 3, class_name: "Retail Customer", class_type: "CUSTOMER", extra: "x" };

  it("lists all classes in one page of 100 when no type is given", async () => {
    const { double, call } = build({ "GET /rest/V1/taxClasses/search": json(200, injectLeakProbe({ items: [RAW], total_count: 1 })) });
    const out = await call("magentorest_get_tax_classes", {});
    const q = params(double.calls[0]?.url);
    expect(q.get("searchCriteria[pageSize]")).toBe("100");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][field]")).toBeNull();
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it.each(["CUSTOMER", "PRODUCT"])("filters by the type %s", async (type) => {
    const { double, call } = build({ "GET /rest/V1/taxClasses/search": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_get_tax_classes", { tax_class_type: type });
    const q = params(double.calls[0]?.url);
    expect([q.get("searchCriteria[filter_groups][0][filters][0][field]"), q.get("searchCriteria[filter_groups][0][filters][0][value]"), q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")]).toEqual(["class_type", type, "eq"]);
  });

  it.each(["customer", "OTHER", "CUSTOMER&x=1", ""])("refuses the type %j, which the original never constrained", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_tax_classes").invoke({ tax_class_type: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});
