// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Cart price rule writes (Kora's request; feature doc odd/tasks/magento-rest-sales-rule-writes.md,
// S1, S2, S4, S5). Magento facts these tests pin (2.4-develop source):
//   - PUT /V1/salesRules/:id merges the non-null fields sent over the stored rule, so an update sends only what
//     changed and never the conditions;
//   - RuleInterface has no coupon_code: the code is the rule's primary coupon, written through /V1/coupons.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { json, type RecordedCall } from "../testing/fetch-double.js";
import { injectLeakProbe, LEAK_PROBE_VALUE } from "../testing/leak-probe.js";
import { buildToolHarness } from "../testing/tool-harness.js";
import { isPersonalField } from "./customer-data.js";
import { promotionTools } from "./promotions-tools.js";
import { BASE_SHAPES } from "./shapes.js";

const build = (routes: Parameters<typeof buildToolHarness>[1]) => buildToolHarness(promotionTools, routes);
const bodyOf = (call: RecordedCall | undefined): unknown => JSON.parse(call?.body ?? "null");
const sent = (calls: readonly RecordedCall[]): string[] => calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);

const CREATE = "magentorest_create_sales_rule";
const UPDATE = "magentorest_update_sales_rule";
const GENERATE = "magentorest_generate_coupons";

const STORED = {
  rule_id: 3,
  name: "Demo 10%",
  description: "d",
  from_date: "2026-01-01",
  to_date: "2026-12-31",
  is_active: true,
  sort_order: 0,
  simple_action: "by_percent",
  discount_amount: 10,
  discount_qty: 0,
  apply_to_shipping: false,
  stop_rules_processing: false,
  coupon_type: "SPECIFIC_COUPON",
  uses_per_coupon: 0,
  uses_per_customer: 0,
  website_ids: [1],
  customer_group_ids: [0, 1],
  condition: { condition_type: "Magento\\SalesRule\\Model\\Rule\\Condition\\Combine", conditions: [], aggregator_type: "all", value: "1" },
  conditions_serialized: "secret-cond",
};
const PRIMARY = { coupon_id: 8, rule_id: 3, code: "DEMO10", is_primary: true, times_used: 4 };
const COUPON_SEARCH = "GET /rest/V1/coupons/search";
const coupons = (...items: unknown[]) => json(200, { items, total_count: items.length });

const CREATE_ARGS = {
  name: "Spring 10%",
  is_active: true,
  website_ids: [1],
  customer_group_ids: [0, 1],
  simple_action: "by_percent",
  discount_amount: 10,
  coupon_type: "NO_COUPON",
};

describe("create_sales_rule", () => {
  it("is a create: not destructive, not idempotent", () => {
    const { tool } = build({});
    expect(tool(CREATE).access).toBe("write");
    expect(tool(CREATE).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it("takes no customer input: only customer group ids", () => {
    const { tool } = build({});
    for (const name of [CREATE, UPDATE, GENERATE]) {
      const keys = Object.keys((tool(name).inputSchema as unknown as { shape: Record<string, unknown> }).shape);
      expect(keys.filter((key) => isPersonalField(key)), name).toEqual([]);
      expect(keys.filter((key) => key.startsWith("customer") && key !== "customer_group_ids"), name).toEqual([]);
    }
  });

  it("posts the rule, then reads it back: the result is the read-back rule with its provenance", async () => {
    const created = { ...STORED, rule_id: 9, name: "Spring 10%", coupon_type: "NO_COUPON" };
    const { double, tool } = build({
      "POST /rest/V1/salesRules": json(200, created),
      "GET /rest/V1/salesRules/9": json(200, injectLeakProbe(created)),
    });
    const outcome = await tool(CREATE).invoke({ ...CREATE_ARGS, description: "Spring sale", from_date: "2026-03-01", to_date: "2026-03-31", discount_qty: 2, apply_to_shipping: true, stop_rules_processing: true, uses_per_customer: 1, sort_order: 5 }, {});
    expect(sent(double.calls)).toEqual(["POST /rest/V1/salesRules", "GET /rest/V1/salesRules/9"]);
    expect(bodyOf(double.calls[0])).toEqual({
      rule: {
        name: "Spring 10%",
        description: "Spring sale",
        is_active: true,
        website_ids: [1],
        customer_group_ids: [0, 1],
        from_date: "2026-03-01",
        to_date: "2026-03-31",
        simple_action: "by_percent",
        discount_amount: 10,
        discount_qty: 2,
        apply_to_shipping: true,
        stop_rules_processing: true,
        coupon_type: "NO_COUPON",
        uses_per_customer: 1,
        sort_order: 5,
      },
    });
    const structured = outcome.structuredContent as { result: Record<string, unknown>; provenance: { endpoint: string } };
    expect(structured.result["rule_id"]).toBe(9);
    expect(structured.result["coupon_code"]).toBeNull();
    expect(structured.provenance.endpoint).toBe("GET /rest/V1/salesRules/9");
    const text = JSON.stringify(structured);
    for (const hidden of ["secret-cond", LEAK_PROBE_VALUE]) expect(text, hidden).not.toContain(hidden);
  });

  it("with a specific coupon, checks the code is free, then saves it as the rule's primary coupon", async () => {
    const created = { ...STORED, rule_id: 9 };
    const { double, call } = build({
      [`${COUPON_SEARCH}`]: [coupons(), coupons({ ...PRIMARY, rule_id: 9, code: "SPRING10" })],
      "POST /rest/V1/salesRules": json(200, created),
      "POST /rest/V1/coupons": json(200, { ...PRIMARY, rule_id: 9, code: "SPRING10" }),
      "GET /rest/V1/salesRules/9": json(200, created),
    });
    const out = (await call(CREATE, { ...CREATE_ARGS, coupon_type: "SPECIFIC_COUPON", coupon_code: "SPRING10", uses_per_coupon: 100 })) as Record<string, unknown>;
    expect(sent(double.calls)).toEqual(["GET /rest/V1/coupons/search", "POST /rest/V1/salesRules", "POST /rest/V1/coupons", "GET /rest/V1/salesRules/9", "GET /rest/V1/coupons/search"]);
    expect((bodyOf(double.calls[1]) as { rule: Record<string, unknown> }).rule).not.toHaveProperty("coupon_code");
    expect(bodyOf(double.calls[2])).toEqual({ coupon: { rule_id: 9, code: "SPRING10", is_primary: true } });
    expect(out["coupon_code"]).toBe("SPRING10");
  });

  it("refuses a code that already exists, before creating anything", async () => {
    const { double, tool } = build({ [COUPON_SEARCH]: coupons(PRIMARY) });
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, coupon_type: "SPECIFIC_COUPON", coupon_code: "DEMO10" }, {})).rejects.toMatchObject({ code: "invalid_argument", argument: "coupon_code" });
    expect(sent(double.calls)).toEqual(["GET /rest/V1/coupons/search"]);
  });

  it("deletes the new rule again when its coupon cannot be saved, and reports the failure", async () => {
    const { double, tool } = build({
      [COUPON_SEARCH]: coupons(),
      "POST /rest/V1/salesRules": json(200, { ...STORED, rule_id: 9 }),
      "POST /rest/V1/coupons": json(400, { message: "Error occurred when saving coupon: %1", parameters: ["x"] }),
      "DELETE /rest/V1/salesRules/9": json(200, true),
    });
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, coupon_type: "SPECIFIC_COUPON", coupon_code: "SPRING10" }, {})).rejects.toThrow();
    expect(sent(double.calls)).toEqual(["GET /rest/V1/coupons/search", "POST /rest/V1/salesRules", "POST /rest/V1/coupons", "DELETE /rest/V1/salesRules/9"]);
  });

  it("names the rule left behind when the rollback fails too", async () => {
    const { tool } = build({
      [COUPON_SEARCH]: coupons(),
      "POST /rest/V1/salesRules": json(200, { ...STORED, rule_id: 9 }),
      "POST /rest/V1/coupons": json(400, { message: "Error occurred when saving coupon: %1", parameters: ["x"] }),
      "DELETE /rest/V1/salesRules/9": json(500, { message: "boom" }),
    });
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, coupon_type: "SPECIFIC_COUPON", coupon_code: "SPRING10" }, {})).rejects.toThrow(/rule 9/);
  });

  it.each([
    [{ coupon_type: "SPECIFIC_COUPON" }, "coupon_code"],
    [{ coupon_code: "SPRING10" }, "coupon_code"],
    [{ coupon_type: "AUTO", coupon_code: "SPRING10" }, "coupon_code"],
    [{ discount_amount: 150 }, "discount_amount"],
    [{ from_date: "2026-04-01", to_date: "2026-03-01" }, "to_date"],
    [{ website_ids: [1, 1] }, "website_ids"],
    [{ customer_group_ids: [0, 0] }, "customer_group_ids"],
  ])("refuses %j as invalid_argument on %s, before any request", async (patch, argument) => {
    const { double, tool } = build({});
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, ...patch }, {})).rejects.toMatchObject({ code: "invalid_argument", argument });
    expect(double.calls).toHaveLength(0);
  });

  it.each([
    ["no website", { website_ids: [] }],
    ["no customer group", { customer_group_ids: [] }],
    ["website 0", { website_ids: [0] }],
    ["a negative discount", { discount_amount: -1 }],
    ["an unknown action", { simple_action: "free" }],
    ["a lowercase coupon type", { coupon_type: "no_coupon" }],
    ["an impossible day", { from_date: "2026-02-30" }],
    ["a code with spaces", { coupon_type: "SPECIFIC_COUPON", coupon_code: "A B" }],
    ["conditions", { condition: {} }],
  ])("refuses %s in the schema, before any request", async (_label, patch) => {
    const { double, tool } = build({});
    await expect(tool(CREATE).invoke({ ...CREATE_ARGS, ...patch }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });

  it("requires the members a rule cannot work without", async () => {
    const { tool } = build({});
    for (const key of ["name", "is_active", "website_ids", "customer_group_ids", "simple_action", "discount_amount", "coupon_type"]) {
      const args: Record<string, unknown> = { ...CREATE_ARGS };
      delete args[key];
      await expect(tool(CREATE).invoke(args, {}), key).rejects.toBeInstanceOf(ZodError);
    }
  });
});

describe("update_sales_rule", () => {
  it("is an update: destructive, idempotent", () => {
    const { tool } = build({});
    expect(tool(UPDATE).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });

  it("sends only the members that differ from the stored rule, never the conditions, then reads it back", async () => {
    const after = { ...STORED, is_active: false };
    const { double, tool } = build({
      "GET /rest/V1/salesRules/3": [json(200, STORED), json(200, after)],
      [COUPON_SEARCH]: coupons(PRIMARY),
      "PUT /rest/V1/salesRules/3": json(200, after),
    });
    const outcome = await tool(UPDATE).invoke({ rule_id: 3, is_active: false, name: "Demo 10%", website_ids: [1], customer_group_ids: [1, 0] }, {});
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/3", "GET /rest/V1/coupons/search", "PUT /rest/V1/salesRules/3", "GET /rest/V1/salesRules/3", "GET /rest/V1/coupons/search"]);
    expect(bodyOf(double.calls[2])).toEqual({ rule: { is_active: false } });
    const structured = outcome.structuredContent as { result: Record<string, unknown>; provenance: { endpoint: string } };
    expect(structured.result["is_active"]).toBe(false);
    expect(structured.result["coupon_code"]).toBe("DEMO10");
    expect(structured.provenance.endpoint).toBe("GET /rest/V1/salesRules/3");
  });

  it("sends nothing when every member already has the given value, so a repeat is a no-op", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [COUPON_SEARCH]: coupons(PRIMARY) });
    await call(UPDATE, { rule_id: 3, is_active: true, discount_amount: 10, to_date: "2026-12-31", coupon_code: "DEMO10" });
    expect(double.calls.map((c) => c.method)).not.toContain("PUT");
    expect(double.calls.map((c) => c.method)).not.toContain("POST");
  });

  it("changes the code of the existing primary coupon in place", async () => {
    const { double, call } = build({
      "GET /rest/V1/salesRules/3": json(200, STORED),
      [COUPON_SEARCH]: [coupons(PRIMARY), coupons({ ...PRIMARY, code: "DEMO20" })],
      "PUT /rest/V1/coupons/8": json(200, { ...PRIMARY, code: "DEMO20" }),
    });
    const out = (await call(UPDATE, { rule_id: 3, coupon_code: "DEMO20" })) as Record<string, unknown>;
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/3", "GET /rest/V1/coupons/search", "PUT /rest/V1/coupons/8", "GET /rest/V1/salesRules/3", "GET /rest/V1/coupons/search"]);
    expect(bodyOf(double.calls[2])).toEqual({ coupon: { coupon_id: 8, rule_id: 3, code: "DEMO20", is_primary: true } });
    expect(out["coupon_code"]).toBe("DEMO20");
  });

  it("switching a rule to a specific coupon sets the type first, then adds the primary coupon", async () => {
    const plain = { ...STORED, coupon_type: "NO_COUPON" };
    const harness = build({
      "GET /rest/V1/salesRules/3": [json(200, plain), json(200, STORED)],
      "PUT /rest/V1/salesRules/3": json(200, STORED),
      "POST /rest/V1/coupons": json(200, PRIMARY),
      [COUPON_SEARCH]: coupons(PRIMARY),
    });
    await harness.call(UPDATE, { rule_id: 3, coupon_type: "SPECIFIC_COUPON", coupon_code: "DEMO10" });
    expect(sent(harness.double.calls)).toEqual(["GET /rest/V1/salesRules/3", "PUT /rest/V1/salesRules/3", "POST /rest/V1/coupons", "GET /rest/V1/salesRules/3", "GET /rest/V1/coupons/search"]);
    expect(bodyOf(harness.double.calls[1])).toEqual({ rule: { coupon_type: "SPECIFIC_COUPON" } });
    expect(bodyOf(harness.double.calls[2])).toEqual({ coupon: { rule_id: 3, code: "DEMO10", is_primary: true } });
  });

  it("answers not_found on rule_id for a rule that does not exist, and writes nothing", async () => {
    const { double, tool } = build({ "GET /rest/V1/salesRules/77": json(404, { message: "The rule with the specified ID doesn't exist." }) });
    await expect(tool(UPDATE).invoke({ rule_id: 77, is_active: false }, {})).rejects.toMatchObject({ code: "not_found", argument: "rule_id" });
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/77"]);
  });

  it.each([
    ["a code on a rule that leaves specific coupons", { coupon_type: "NO_COUPON", coupon_code: "X1" }, "coupon_code"],
    ["a percent above 100 on a percent rule", { discount_amount: 150 }, "discount_amount"],
    ["an end before the stored start", { to_date: "2025-12-31" }, "to_date"],
    ["nothing to change", {}, "rule_id"],
  ])("refuses %s as invalid_argument, and writes nothing", async (_label, patch, argument) => {
    const { double, tool } = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [COUPON_SEARCH]: coupons(PRIMARY) });
    await expect(tool(UPDATE).invoke({ rule_id: 3, ...patch }, {})).rejects.toMatchObject({ code: "invalid_argument", argument });
    expect(double.calls.map((c) => c.method).filter((m) => m !== "GET")).toEqual([]);
  });

  it("refuses null: Magento keeps a field sent as null, so clearing cannot be offered", async () => {
    const { double, tool } = build({});
    await expect(tool(UPDATE).invoke({ rule_id: 3, to_date: null }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});

describe("get_sales_rule_by_id carries every member the writes accept", () => {
  it("adds the primary coupon's code for a specific-coupon rule", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, STORED), [COUPON_SEARCH]: coupons(PRIMARY) });
    const out = (await call("magentorest_get_sales_rule_by_id", { rule_id: 3 })) as Record<string, unknown>;
    const q = new URL(double.calls[1]?.url ?? "").searchParams;
    expect([q.get("searchCriteria[filter_groups][0][filters][0][field]"), q.get("searchCriteria[filter_groups][0][filters][0][value]")]).toEqual(["rule_id", "3"]);
    expect([q.get("searchCriteria[filter_groups][1][filters][0][field]"), q.get("searchCriteria[filter_groups][1][filters][0][value]")]).toEqual(["is_primary", "1"]);
    const writable = ["name", "description", "is_active", "website_ids", "customer_group_ids", "from_date", "to_date", "simple_action", "discount_amount", "discount_qty", "apply_to_shipping", "stop_rules_processing", "coupon_type", "coupon_code", "uses_per_coupon", "uses_per_customer", "sort_order"];
    for (const key of writable) expect(out, key).toHaveProperty(key);
    expect(out["coupon_code"]).toBe("DEMO10");
  });

  it("reports coupon_code null without a coupon request when the rule takes no specific coupon", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, coupon_type: "NO_COUPON" }) });
    const out = (await call("magentorest_get_sales_rule_by_id", { rule_id: 3 })) as Record<string, unknown>;
    expect(out["coupon_code"]).toBeNull();
    expect(double.calls).toHaveLength(1);
  });

  it("every member create_sales_rule accepts is a member the read returns", () => {
    const { tool } = build({});
    const createKeys = Object.keys((tool(CREATE).inputSchema as unknown as { shape: Record<string, unknown> }).shape);
    const updateKeys = Object.keys((tool(UPDATE).inputSchema as unknown as { shape: Record<string, unknown> }).shape).filter((key) => key !== "rule_id");
    // The read projects through the sales_rule allowlist, so a member missing from it would be dropped from the read.
    const readKeys = BASE_SHAPES.sales_rule.filter((entry): entry is string => typeof entry === "string");
    expect(createKeys.filter((key) => !readKeys.includes(key))).toEqual([]);
    expect(updateKeys.sort()).toEqual(createKeys.sort());
  });
});

describe("generate_coupons", () => {
  const AUTO_RULE = { ...STORED, coupon_type: "AUTO", use_auto_generation: true };

  it("is a create: not destructive, not idempotent (each call adds codes)", () => {
    const { tool } = build({});
    expect(tool(GENERATE).access).toBe("write");
    expect(tool(GENERATE).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it("checks the rule takes generated codes, then generates them and returns the codes with provenance", async () => {
    const { double, tool } = build({
      "GET /rest/V1/salesRules/3": json(200, AUTO_RULE),
      "POST /rest/V1/coupons/generate": json(200, ["SPR-AB12", "SPR-CD34"]),
    });
    const outcome = await tool(GENERATE).invoke({ rule_id: 3, qty: 2, length: 4, format: "alphanum", code_prefix: "SPR-" }, {});
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/3", "POST /rest/V1/coupons/generate"]);
    expect(bodyOf(double.calls[1])).toEqual({ couponSpec: { rule_id: 3, quantity: 2, length: 4, format: "alphanum", prefix: "SPR-" } });
    const structured = outcome.structuredContent as { rule_id: number; codes: string[]; provenance: { endpoint: string } };
    expect(structured.rule_id).toBe(3);
    expect(structured.codes).toEqual(["SPR-AB12", "SPR-CD34"]);
    expect(structured.provenance.endpoint).toBe("POST /rest/V1/coupons/generate");
  });

  it("defaults to 12 alphanumeric characters with no prefix", async () => {
    const { double, call } = build({ "GET /rest/V1/salesRules/3": json(200, AUTO_RULE), "POST /rest/V1/coupons/generate": json(200, ["A"]) });
    await call(GENERATE, { rule_id: 3, qty: 1 });
    expect(bodyOf(double.calls[1])).toEqual({ couponSpec: { rule_id: 3, quantity: 1, length: 12, format: "alphanum" } });
  });

  it("refuses a rule that does not take generated codes, on rule_id, before generating", async () => {
    const { double, tool } = build({ "GET /rest/V1/salesRules/3": json(200, { ...STORED, coupon_type: "NO_COUPON", use_auto_generation: false }) });
    await expect(tool(GENERATE).invoke({ rule_id: 3, qty: 1 }, {})).rejects.toMatchObject({ code: "invalid_argument", argument: "rule_id" });
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/3"]);
  });

  it("accepts a specific-coupon rule set to auto-generate its codes", async () => {
    const { double, call } = build({
      "GET /rest/V1/salesRules/3": json(200, { ...STORED, coupon_type: "SPECIFIC_COUPON", use_auto_generation: true }),
      [COUPON_SEARCH]: coupons(),
      "POST /rest/V1/coupons/generate": json(200, ["A"]),
    });
    await call(GENERATE, { rule_id: 3, qty: 1 });
    expect(double.calls.at(-1)?.method).toBe("POST");
  });

  it("answers not_found on rule_id for a rule that does not exist", async () => {
    const { double, tool } = build({ "GET /rest/V1/salesRules/77": json(404, { message: "The rule with the specified ID doesn't exist." }) });
    await expect(tool(GENERATE).invoke({ rule_id: 77, qty: 1 }, {})).rejects.toMatchObject({ code: "not_found", argument: "rule_id" });
    expect(sent(double.calls)).toEqual(["GET /rest/V1/salesRules/77"]);
  });

  it.each([
    ["no quantity", {}],
    ["a quantity of 0", { qty: 0 }],
    ["more than 100 codes", { qty: 101 }],
    ["an unknown format", { qty: 1, format: "hex" }],
    ["a length of 0", { qty: 1, length: 0 }],
    ["a prefix with spaces", { qty: 1, code_prefix: "A B" }],
  ])("refuses %s in the schema, before any request", async (_label, patch) => {
    const { double, tool } = build({});
    await expect(tool(GENERATE).invoke({ rule_id: 3, ...patch }, {})).rejects.toBeInstanceOf(ZodError);
    expect(double.calls).toHaveLength(0);
  });
});
