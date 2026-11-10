// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Ported from the original `promotions.js`. The original's
// `search_coupons` accepted `is_active` and never used it — a filter that
// filters nothing — so it is not ported; a coupon has no active flag to filter
// on, and a parameter that silently does nothing is worse than none.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { promotionTools } from "./promotions-tools.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(promotionTools, routes);
const params = (url: string | undefined): URLSearchParams => new URL(url ?? "").searchParams;

const RAW_RULE = { rule_id: 3, name: "Demo 10%", description: "d", from_date: "2026-01-01", to_date: "2026-12-31", is_active: true, sort_order: 0, simple_action: "by_percent", discount_amount: 10, coupon_type: "SPECIFIC_COUPON", website_ids: [1], customer_group_ids: [0, 1], conditions_serialized: "secret-cond", actions_serialized: "secret-act", store_labels: [{ store_id: 0, store_label: "x" }] };
const RAW_COUPON = { coupon_id: 8, rule_id: 3, code: "DEMO10", usage_limit: 100, usage_per_customer: 1, times_used: 4, expiration_date: "2026-12-31", is_primary: true, created_at: "2026-01-01 00:00:00", type: 0, extension_attributes: { secret: "x" } };

describe("promotionTools surface", () => {
  it("exposes four reads and one write, all prefixed", () => {
    const { tools } = build({});
    expect(tools.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual(["magentorest_get_coupon_by_id", "magentorest_get_sales_rule_by_id", "magentorest_get_sales_rules", "magentorest_search_coupons"]);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name)).toEqual(["magentorest_delete_coupon"]);
  });
});

describe("sales rules", () => {
  it("get_sales_rules lists the rules with a bounded page of 50, projected", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/search": json(200, injectLeakProbe({ items: [RAW_RULE], total_count: 1 })) });
    const out = (await call("magentorest_get_sales_rules", {})) as { items: Record<string, unknown>[]; total_count: number };
    expect(params(double.calls[0]?.url).get("searchCriteria[pageSize]")).toBe("50");
    expect(out.items[0]?.["name"]).toBe("Demo 10%");
    const text = JSON.stringify(out);
    for (const hidden of ["secret-cond", "secret-act", "store_labels", LEAK_PROBE_VALUE]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it("get_sales_rules refuses a page size above 100", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_get_sales_rules").invoke({ page_size: 101 }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("get_sales_rule_by_id reads one rule, projected", async () => {
    const { call } = build({ "GET /rest/V1/salesRules/3": json(200, injectLeakProbe(RAW_RULE)) });
    const out = (await call("magentorest_get_sales_rule_by_id", { rule_id: 3 })) as Record<string, unknown>;
    expect(out["discount_amount"]).toBe(10);
    expect(out["website_ids"]).toEqual([1]);
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("get_sales_rule_by_id refuses a non-positive ID before any request", async () => {
    const { double, tool } = build({});
    await expect(tool("magentorest_get_sales_rule_by_id").invoke({ rule_id: 0 }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("coupons", () => {
  it("search_coupons filters by part of the code and by rule, each in its own group", async () => {
    const { double, call } = build({ "GET /rest/V1/coupons/search": json(200, injectLeakProbe({ items: [RAW_COUPON], total_count: 1 })) });
    const out = await call("magentorest_search_coupons", { code: "DEMO", rule_id: 3 });
    const q = params(double.calls[0]?.url);
    const f = (g: number, k: string): string | null => q.get(`searchCriteria[filter_groups][${g}][filters][0][${k}]`);
    expect([f(0, "field"), f(0, "value"), f(0, "condition_type")]).toEqual(["code", "%DEMO%", "like"]);
    expect([f(1, "field"), f(1, "value"), f(1, "condition_type")]).toEqual(["rule_id", "3", "eq"]);
    expect(q.get("searchCriteria[pageSize]")).toBe("50");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
    expect(JSON.stringify(out)).not.toContain('"secret"');
  });

  it("search_coupons no longer takes the is_active filter the original ignored", async () => {
    const { tool } = build({});
    await expect(tool("magentorest_search_coupons").invoke({ is_active: true }, {})).rejects.toBeInstanceOf(ZodError);
  });

  it.each(["a b", "x&y", "", "x".repeat(65)])("search_coupons refuses the code %j", async (bad) => {
    const { double, tool } = build({});
    await expect(tool("magentorest_search_coupons").invoke({ code: bad }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("get_coupon_by_id reads one coupon, projected", async () => {
    const { call } = build({ "GET /rest/V1/coupons/8": json(200, injectLeakProbe(RAW_COUPON)) });
    const out = (await call("magentorest_get_coupon_by_id", { coupon_id: 8 })) as Record<string, unknown>;
    expect(out["code"]).toBe("DEMO10");
    expect(JSON.stringify(out)).not.toContain(LEAK_PROBE_VALUE);
  });

  it("delete_coupon returns Magento's boolean, is destructive, and is not replayed on a retryable failure", async () => {
    const ok = build({ "DELETE /rest/V1/coupons/8": json(200, true) });
    expect(await ok.call("magentorest_delete_coupon", { coupon_id: 8 })).toBe(true);
    expect(ok.tool("magentorest_delete_coupon").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const busy = build({ "DELETE /rest/V1/coupons/8": json(503, { message: "busy" }) });
    await expect(busy.tool("magentorest_delete_coupon").invoke({ coupon_id: 8 }, {})).rejects.toMatchObject({ kind: "server" });
    expect(busy.double.calls).toHaveLength(1);
  });
});
