// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `customers.js`. Customers are personal
// data, so the cases that matter most here are about what does NOT come back
// (date of birth, tax number, the address book, street and telephone) and
// about what is no longer accepted (a password passing through the model).
import { SYNTHETIC_MAGENTO_CUSTOMER_EMAIL } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { customerTools } from "./customers-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(customerTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_CUSTOMER = {
  id: 9,
  group_id: 1,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-02 00:00:00",
  email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL,
  firstname: "Demo",
  lastname: "Shopper",
  store_id: 1,
  website_id: 1,
  default_billing: "3",
  default_shipping: "3",
  dob: "1990-05-05",
  taxvat: "TAX-DEMO-1",
  gender: 1,
  addresses: [{ id: 3, customer_id: 9, street: ["1 Demo Street"], telephone: "000", city: "Madrid", postcode: "28001", country_id: "ES", region_id: 0, region: { region_code: "M", region: "Madrid" }, default_billing: true, default_shipping: true }],
};

describe("customerTools surface", () => {
  it("exposes the four reads and the three writes, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "magentorest_get_customer_addresses",
      "magentorest_get_customer_by_id",
      "magentorest_get_customer_groups",
      "magentorest_search_customers",
    ]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual(["magentorest_create_customer", "magentorest_delete_customer", "magentorest_update_customer"]);
  });
});

describe("magentorest_get_customer_by_id", () => {
  it("returns the identity fields and nothing personal beyond them", async () => {
    const { call } = build({ "GET /rest/V1/customers/9": json(200, injectLeakProbe(RAW_CUSTOMER)) });
    const out = (await call("magentorest_get_customer_by_id", { customer_id: 9 })) as Record<string, unknown>;
    expect(out["email"]).toBe(SYNTHETIC_MAGENTO_CUSTOMER_EMAIL);
    for (const hidden of ["dob", "taxvat", "gender", "addresses"]) {
      expect(out, hidden).not.toHaveProperty(hidden);
    }
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(JSON.stringify(out)).not.toContain("TAX-DEMO-1");
  });

  it("refuses a non-positive or non-integer ID before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_customer_by_id").invoke({ customer_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_get_customer_by_id").invoke({ customer_id: "9" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("magentorest_search_customers", () => {
  it("puts each filter in its own group (AND) with the right comparison, and bounds the page", async () => {
    const { double, call } = build({ "GET /rest/V1/customers/search": json(200, { items: [RAW_CUSTOMER], total_count: 1 }) });
    await call("magentorest_search_customers", { email: "shopper", firstname: "dem", lastname: "shop", group_id: 1, website_id: 2, created_at_from: "2026-01-01", created_at_to: "2026-02-01" });
    const q = params(double.calls[0]?.url);
    const at = (group: number, key: string): string | null => q.get(`searchCriteria[filter_groups][${group}][filters][0][${key}]`);
    expect([at(0, "field"), at(0, "value"), at(0, "condition_type")]).toEqual(["email", "%shopper%", "like"]);
    expect(at(1, "field")).toBe("firstname");
    expect(at(2, "field")).toBe("lastname");
    expect([at(3, "field"), at(3, "value"), at(3, "condition_type")]).toEqual(["group_id", "1", "eq"]);
    expect([at(4, "field"), at(4, "value")]).toEqual(["website_id", "2"]);
    expect([at(5, "field"), at(5, "value"), at(5, "condition_type")]).toEqual(["created_at", "2026-01-01", "gteq"]);
    expect([at(6, "field"), at(6, "value"), at(6, "condition_type")]).toEqual(["created_at", "2026-02-01", "lteq"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("20");
  });

  it("returns summaries only, with the total", async () => {
    const { call } = build({ "GET /rest/V1/customers/search": json(200, injectLeakProbe({ items: [RAW_CUSTOMER], total_count: 1 })) });
    const out = (await call("magentorest_search_customers", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(out.total_count).toBe(1);
    expect(Object.keys(out.items[0] ?? {}).sort()).toEqual(["created_at", "email", "firstname", "group_id", "id", "lastname", "website_id"]);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("keeps a value containing & inside its one value", async () => {
    const { double, call } = build({ "GET /rest/V1/customers/search": json(200, { items: [], total_count: 0 }) });
    await call("magentorest_search_customers", { email: "x&searchCriteria[pageSize]=9999" });
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("20");
  });

  it.each(["yesterday", "2026-1-1", "2026-01-01T00:00:00", "20260101", ""])("refuses the date %j", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_search_customers").invoke({ created_at_from: bad }, {})).rejects.toBeInstanceOf(ZodError);
    await expect(tool("magentorest_search_customers").invoke({ created_at_to: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_search_customers").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });
});

describe("magentorest_get_customer_groups", () => {
  it("lists the groups with a bounded page of 100", async () => {
    const { double, call } = build({ "GET /rest/V1/customerGroups/search": json(200, injectLeakProbe({ items: [{ id: 1, code: "General", tax_class_id: 3, tax_class_name: "Retail Customer" }], total_count: 1 })) });
    const out = (await call("magentorest_get_customer_groups", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("100");
    expect(out.items[0]).toEqual({ id: 1, code: "General", tax_class_id: 3, tax_class_name: "Retail Customer" });
  });
});

describe("magentorest_get_customer_addresses", () => {
  it("returns the addresses with location fields only: no street, telephone or addressee", async () => {
    const { call } = build({ "GET /rest/V1/customers/9": json(200, injectLeakProbe(RAW_CUSTOMER)) });
    const out = (await call("magentorest_get_customer_addresses", { customer_id: 9 })) as Record<string, unknown>[];
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 3, customer_id: 9, country_id: "ES", region_id: 0, city: "Madrid", postcode: "28001", default_billing: true, default_shipping: true, region: { region_code: "M", region: "Madrid" } });
    expect(JSON.stringify(out)).not.toContain("1 Demo Street");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("returns an empty list for a customer with no addresses", async () => {
    const { call } = build({ "GET /rest/V1/customers/9": json(200, { id: 9 }) });
    expect(await call("magentorest_get_customer_addresses", { customer_id: 9 })).toEqual([]);
  });
});

describe("customer writes", () => {
  it("create_customer defaults group, website and store, and never sends a password", async () => {
    const { double, call } = build({ "POST /rest/V1/customers": json(200, RAW_CUSTOMER) });
    await call("magentorest_create_customer", { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "Demo", lastname: "Shopper" });
    expect(JSON.parse(double.calls[0]?.body ?? "{}")).toEqual({ customer: { email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "Demo", lastname: "Shopper", group_id: 1, website_id: 1, store_id: 1 } });
  });

  it("create_customer refuses a password argument: a credential must not pass through the model", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_create_customer").invoke({ email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "D", lastname: "S", password: "x" }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("create_customer refuses an invalid email", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_create_customer").invoke({ email: "not-an-email", firstname: "D", lastname: "S" }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("update_customer reads the existing record, then PUTs the merge, keeping what was not changed", async () => {
    const { double, call } = build({ "GET /rest/V1/customers/9": json(200, RAW_CUSTOMER), "PUT /rest/V1/customers/9": json(200, RAW_CUSTOMER) });
    await call("magentorest_update_customer", { customer_id: 9, lastname: "Renamed", group_id: 2 });
    expect(double.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(double.calls[1]?.body ?? "{}")).toEqual({ customer: { id: 9, email: SYNTHETIC_MAGENTO_CUSTOMER_EMAIL, firstname: "Demo", lastname: "Renamed", website_id: 1, group_id: 2 } });
  });

  it("update_customer refuses an update that changes nothing, without calling Magento", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_update_customer").invoke({ customer_id: 9 }, {})).rejects.toThrow(/nothing to update/i);
    expect(double.calls).toHaveLength(0);
  });

  it("update_customer treats an empty string as a real value, not as 'keep the old one'", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_update_customer").invoke({ customer_id: 9, firstname: "" }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("delete_customer returns Magento's boolean and is destructive", async () => {
    const { double, call, tool } = build({ "DELETE /rest/V1/customers/9": json(200, true) });
    expect(await call("magentorest_delete_customer", { customer_id: 9 })).toBe(true);
    expect(double.calls[0]?.method).toBe("DELETE");
    expect(tool("magentorest_delete_customer").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});
