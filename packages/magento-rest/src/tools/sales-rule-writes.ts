// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Cart price rule writes: create, a partial update, and coupon generation (Kora's request; feature doc
// odd/tasks/magento-rest-sales-rule-writes.md). What Magento does, read in its 2.4-develop source, and what follows:
//
//   - PUT /V1/salesRules/:id loads the stored rule and merges over it only the fields sent that are not null
//     (Converter\ToModel::toModel). So the update reads the rule first and sends only the members whose value
//     differs; it never sends the conditions, which Magento then keeps, and a repeat call sends nothing. A null
//     cannot clear a field there, so no member accepts null: clearing a date is not offered.
//   - RuleInterface has no coupon code. The code is the rule's PRIMARY coupon, written through /V1/coupons, and
//     read back from it. A create checks the code is free first; if the coupon still cannot be saved, the rule this
//     call just created is deleted again, so a failed create leaves nothing behind.
//   - Model\Rule::afterSave deletes the primary coupon when the rule stops being a specific-coupon rule, use count
//     included. The update's description says so.
//   - A create without websites or customer groups is accepted by Magento and saves a rule that applies nowhere, so
//     both are required here.
//   - coupon_type is Magento's own REST value (NO_COUPON, SPECIFIC_COUPON, AUTO), the value the read returns, so a
//     host can read before and write back the same members.
//
//   - POST /V1/coupons/generate needs a rule with coupon_type AUTO or use_auto_generation, has no quantity cap and
//     saves one coupon per code synchronously: the rule is checked first (a typed refusal instead of Magento's
//     wrapped one), and a call makes at most 100 codes.
//
// Conditions are not offered: a rule is created without any, and an update leaves the stored ones untouched.
import { z } from "zod";
import { MagentoRestError, restPath, type MagentoRestClient } from "../client/index.js";
import { calendarDay, entityId } from "./inputs.js";
import { project } from "./project.js";
import { provenanceSchema, readOutputSchema } from "./output-schema.js";
import { provenanceOf, type MagentoRestTool, type ToolFactory } from "./rest-tool.js";
import { ToolArgumentError } from "./tool-error.js";

export const CREATE_SALES_RULE_TOOL = "magentorest_create_sales_rule";
export const UPDATE_SALES_RULE_TOOL = "magentorest_update_sales_rule";
export const GENERATE_COUPONS_TOOL = "magentorest_generate_coupons";

/** Magento has no cap and generates synchronously, one saved coupon per code; this keeps a call short. */
const MAX_GENERATED = 100;
const COUPON_FORMATS = ["alphanum", "alpha", "num"] as const;

const generatedSchema = z.object({ rule_id: z.number(), codes: z.array(z.string()), provenance: provenanceSchema });

const SIMPLE_ACTIONS = ["by_percent", "by_fixed", "cart_fixed", "buy_x_get_y"] as const;
const COUPON_TYPES = ["NO_COUPON", "SPECIFIC_COUPON", "AUTO"] as const;

const count = (what: string) => z.number().int().min(0).max(1_000_000_000).describe(what);

/** Every member a create takes; the update takes the same members, each optional. */
const members = {
  name: z.string().min(1).max(255).describe("Rule name, shown in the admin."),
  description: z.string().max(65_535).describe("Internal description."),
  is_active: z.boolean().describe("Whether the rule applies."),
  website_ids: z.array(z.number().int().min(1)).min(1).max(100).describe("Websites the rule applies on (at least one)."),
  customer_group_ids: z.array(z.number().int().min(0)).min(1).max(1000).describe("Customer groups the rule applies to (at least one; 0 is NOT LOGGED IN)."),
  from_date: calendarDay("First day the rule applies (YYYY-MM-DD)."),
  to_date: calendarDay("Last day the rule applies (YYYY-MM-DD)."),
  simple_action: z.enum(SIMPLE_ACTIONS).describe("Discount type: by_percent of each item, by_fixed amount per item, cart_fixed amount for the whole cart, buy_x_get_y."),
  discount_amount: z.number().min(0).max(100_000_000).describe("Discount amount: a percent (at most 100) for by_percent, else an amount; for buy_x_get_y, the Y."),
  discount_qty: z.number().min(0).max(1_000_000).describe("Maximum quantity the discount applies to (0 for no limit)."),
  apply_to_shipping: z.boolean().describe("Whether the discount also applies to the shipping amount."),
  stop_rules_processing: z.boolean().describe("Whether rules with a later sort order stop being applied after this one."),
  coupon_type: z.enum(COUPON_TYPES).describe("NO_COUPON (applies without a code), SPECIFIC_COUPON (needs coupon_code), or AUTO (codes made with magentorest_generate_coupons)."),
  coupon_code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,255}$/, "letters, digits, _ and - only (max 255)")
    .describe("The code customers enter; only with coupon_type SPECIFIC_COUPON, and required with it."),
  uses_per_coupon: count("How many times the code can be used in total (0 for no limit)."),
  uses_per_customer: count("How many times one customer can use the rule (0 for no limit)."),
  sort_order: count("Priority: lower numbers apply first."),
} as const;

type Member = keyof typeof members;
type Members = { -readonly [K in Member]?: z.infer<(typeof members)[K]> | undefined };

/** The members written to the rule itself; coupon_code goes to its primary coupon. */
const RULE_MEMBERS = (Object.keys(members) as Member[]).filter((key) => key !== "coupon_code");
const SET_MEMBERS: ReadonlySet<Member> = new Set(["website_ids", "customer_group_ids"]);

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** The stored rule plus its primary coupon, as one record with `coupon_code` (null when it has none). */
interface StoredRule {
  readonly rule: Record<string, unknown>;
  readonly primaryCouponId: number | undefined;
}

const isMissing = (error: unknown): boolean => error instanceof MagentoRestError && error.kind === "not-found";

/** One rule and its primary coupon's code: GET the rule, then, for a specific-coupon rule, its primary coupon. */
export async function readSalesRule(client: MagentoRestClient, ruleId: number): Promise<StoredRule> {
  const rule = record(await client.get(restPath`/salesRules/${ruleId}`));
  if (rule["coupon_type"] !== "SPECIFIC_COUPON") return { rule: { ...rule, coupon_code: null }, primaryCouponId: undefined };
  const primary = record(
    (
      await client.search("/coupons/search", {
        filterGroups: [[{ field: "rule_id", value: ruleId }], [{ field: "is_primary", value: 1 }]],
        pageSize: 1,
        currentPage: 1,
      })
    ).items[0],
  );
  const code = typeof primary["code"] === "string" ? primary["code"] : null;
  const id = typeof primary["coupon_id"] === "number" ? primary["coupon_id"] : undefined;
  return { rule: { ...rule, coupon_code: code }, primaryCouponId: code === null ? undefined : id };
}

/** Two arrays of ids holding the same ids, in any order. */
const sameSet = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].map(Number).sort().join(",") === [...b].map(Number).sort().join(",");

/** Whether a given member already has this value in the stored rule (as Magento returns it). */
function unchanged(key: Member, given: unknown, stored: unknown): boolean {
  if (SET_MEMBERS.has(key)) return sameSet(given, stored);
  if (typeof given === "number") return stored !== null && stored !== undefined && stored !== "" && Number(stored) === given;
  if (key === "from_date" || key === "to_date") return typeof stored === "string" && stored.slice(0, 10) === given;
  return stored === given;
}

/** The checks that need more than one member, on the rule as it will be after the write. */
function checkCombination(effective: Members, given: Members, needsCode: boolean): void {
  for (const key of SET_MEMBERS) {
    const ids = given[key] as readonly number[] | undefined;
    if (ids !== undefined && new Set(ids).size !== ids.length) throw new ToolArgumentError("invalid_argument", key, `${key} lists an id more than once.`);
  }
  if (given.coupon_code !== undefined && effective.coupon_type !== "SPECIFIC_COUPON") {
    throw new ToolArgumentError("invalid_argument", "coupon_code", "coupon_code is only for a rule with coupon_type SPECIFIC_COUPON.");
  }
  if (needsCode && given.coupon_code === undefined) {
    throw new ToolArgumentError("invalid_argument", "coupon_code", "A SPECIFIC_COUPON rule needs coupon_code: the code customers enter.");
  }
  if (effective.simple_action === "by_percent" && typeof effective.discount_amount === "number" && effective.discount_amount > 100) {
    throw new ToolArgumentError("invalid_argument", "discount_amount", "A by_percent discount is at most 100.");
  }
  if (effective.from_date !== undefined && effective.to_date !== undefined && effective.to_date < effective.from_date) {
    throw new ToolArgumentError("invalid_argument", "to_date", "to_date must not be before from_date.");
  }
}

/** The stored rule's members, in the shape the inputs use (dates as YYYY-MM-DD). */
function storedMembers(rule: Record<string, unknown>): Members {
  const out: Record<string, unknown> = {};
  for (const key of RULE_MEMBERS) {
    const value = rule[key];
    if (value === null || value === undefined || value === "") continue;
    out[key] = (key === "from_date" || key === "to_date") && typeof value === "string" ? value.slice(0, 10) : value;
  }
  return out as Members;
}

const pick = (args: Members, keys: readonly Member[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));

export function salesRuleWriteTools({ shapedTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  const output = readOutputSchema(shapes.sales_rule);

  /** The rule read back after the write, as `get_sales_rule_by_id` reports it, with this read's provenance. */
  const readBack = async (client: MagentoRestClient, answers: Parameters<typeof provenanceOf>[0], ruleId: number) => {
    const { rule } = await readSalesRule(client, ruleId);
    return { result: project(rule, shapes.sales_rule), provenance: provenanceOf(answers) };
  };

  return [
    shapedTool({
      name: CREATE_SALES_RULE_TOOL,
      description:
        "Use this to create a cart price rule (a promotion) without conditions: it discounts every cart on its websites and customer groups, between its dates. " +
        "Adds a rule, inactive unless is_active is true; with coupon_type SPECIFIC_COUPON it also adds coupon_code as the rule's code, which must not exist yet. " +
        "If the code cannot be saved, the new rule is deleted again and nothing is kept. Returns the rule as read back.",
      effect: "create",
      input: z
        .object({
          name: members.name,
          description: members.description.optional(),
          is_active: members.is_active,
          website_ids: members.website_ids,
          customer_group_ids: members.customer_group_ids,
          from_date: members.from_date.optional(),
          to_date: members.to_date.optional(),
          simple_action: members.simple_action,
          discount_amount: members.discount_amount,
          discount_qty: members.discount_qty.optional(),
          apply_to_shipping: members.apply_to_shipping.optional(),
          stop_rules_processing: members.stop_rules_processing.optional(),
          coupon_type: members.coupon_type,
          coupon_code: members.coupon_code.optional(),
          uses_per_coupon: members.uses_per_coupon.optional(),
          uses_per_customer: members.uses_per_customer.optional(),
          sort_order: members.sort_order.optional(),
        })
        .strict(),
      output,
      run: async (args, track) => {
        checkCombination(args, args, args.coupon_type === "SPECIFIC_COUPON");
        const write = track();
        const code = args.coupon_code;
        if (code !== undefined) {
          const taken = await write.client.search("/coupons/search", { filterGroups: [[{ field: "code", value: code }]], pageSize: 1, currentPage: 1 });
          if (taken.items.length > 0) throw new ToolArgumentError("invalid_argument", "coupon_code", "A coupon with that code already exists: nothing was created.");
        }
        const created = record(await write.client.post("/salesRules", { rule: pick(args, RULE_MEMBERS) }));
        const ruleId = created["rule_id"];
        if (typeof ruleId !== "number") throw new Error("Magento accepted the rule but answered without its rule_id, so it cannot be read back: confirm with magentorest_get_sales_rules.");
        if (code !== undefined) {
          try {
            await write.client.post("/coupons", { coupon: { rule_id: ruleId, code, is_primary: true } });
          } catch (error) {
            try {
              await write.client.delete(restPath`/salesRules/${ruleId}`);
            } catch {
              throw new Error(`The rule was created as rule ${ruleId}, but its coupon code could not be saved and deleting the rule failed: delete it or set its code with ${UPDATE_SALES_RULE_TOOL}.`);
            }
            throw error;
          }
        }
        const after = track();
        return readBack(after.client, after.answers, ruleId);
      },
    }),

    shapedTool({
      name: UPDATE_SALES_RULE_TOOL,
      description:
        "Use this to change members of an existing cart price rule, for example to deactivate it (is_active false) or to restore earlier values. " +
        "Only the members you pass, and only those that differ from the stored rule, are sent; its conditions are never touched. Overwrites the current values on the live store. " +
        "A field cannot be cleared (Magento keeps a field sent empty). Changing coupon_type away from SPECIFIC_COUPON makes Magento delete the rule's code and its use count. Returns the rule as read back.",
      effect: "update",
      input: z
        .object({
          rule_id: entityId("cart price rule to change"),
          ...Object.fromEntries(Object.entries(members).map(([key, schema]) => [key, schema.optional()])),
        })
        .strict() as z.ZodObject<{ rule_id: z.ZodNumber } & { [K in Member]: z.ZodOptional<(typeof members)[K]> }>,
      output,
      run: async (input, track) => {
        const { rule_id: ruleId, ...given } = input as { rule_id: number } & Members;
        if ((Object.keys(given) as Member[]).every((key) => given[key] === undefined)) {
          throw new ToolArgumentError("invalid_argument", "rule_id", "Nothing to change: pass at least one member besides rule_id.");
        }
        if (given.coupon_code !== undefined && given.coupon_type !== undefined && given.coupon_type !== "SPECIFIC_COUPON") {
          throw new ToolArgumentError("invalid_argument", "coupon_code", "coupon_code is only for a rule with coupon_type SPECIFIC_COUPON.");
        }

        const write = track();
        let stored: StoredRule;
        try {
          stored = await readSalesRule(write.client, ruleId);
        } catch (error) {
          if (isMissing(error)) throw new ToolArgumentError("not_found", "rule_id", "No cart price rule with that ID: nothing was written.");
          throw error;
        }
        const current = storedMembers(stored.rule);
        const changed = RULE_MEMBERS.filter((key) => given[key] !== undefined && !unchanged(key, given[key], stored.rule[key]));
        const currentCode = stored.rule["coupon_code"] as string | null;
        const effective: Members = { ...current, ...pick(given, RULE_MEMBERS) };
        // A code is required only when the rule BECOMES a specific-coupon rule: one that already is may have no
        // primary coupon (its codes auto-generated), and changing another member must not demand one.
        checkCombination(effective, given, given.coupon_type === "SPECIFIC_COUPON" && current.coupon_type !== "SPECIFIC_COUPON");

        if (changed.length > 0) await write.client.put(restPath`/salesRules/${ruleId}`, { rule: pick(given, changed) });
        if (given.coupon_code !== undefined && given.coupon_code !== currentCode) {
          // After the PUT: a rule that just became SPECIFIC_COUPON has no primary coupon yet, and one that already was
          // keeps its own through the PUT (Magento reloads the code before saving).
          if (stored.primaryCouponId !== undefined && current.coupon_type === "SPECIFIC_COUPON") {
            await write.client.put(restPath`/coupons/${stored.primaryCouponId}`, { coupon: { coupon_id: stored.primaryCouponId, rule_id: ruleId, code: given.coupon_code, is_primary: true } });
          } else {
            await write.client.post("/coupons", { coupon: { rule_id: ruleId, code: given.coupon_code, is_primary: true } });
          }
        }

        const after = track();
        return readBack(after.client, after.answers, ruleId);
      },
    }),

    shapedTool({
      name: GENERATE_COUPONS_TOOL,
      description:
        "Use this to generate new coupon codes for a cart price rule that takes generated codes (coupon_type AUTO, or a SPECIFIC_COUPON rule set to auto-generate). " +
        "Adds qty codes (at most 100), each usable as the rule's uses_per_coupon allows until its to_date; every call adds more. Returns the codes.",
      effect: "create",
      input: z
        .object({
          rule_id: entityId("cart price rule the codes are for"),
          qty: z.number().int().min(1).max(MAX_GENERATED).describe(`How many codes to generate (at most ${MAX_GENERATED}).`),
          length: z.number().int().min(1).max(32).optional().describe("Characters in each code, not counting the prefix (default 12; Magento lengthens it when too few codes of that length remain)."),
          format: z.enum(COUPON_FORMATS).optional().describe("Characters used: alphanum (default), alpha or num."),
          // Not `prefix`: that is a customer's name prefix on the personal-field list a host checks inputs against.
          code_prefix: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, "letters, digits, _ and - only (max 32)").optional().describe("Text every code starts with."),
        })
        .strict(),
      output: generatedSchema,
      run: async ({ rule_id: ruleId, qty, length, format, code_prefix: prefix }, track) => {
        const check = track();
        let stored: StoredRule;
        try {
          stored = await readSalesRule(check.client, ruleId);
        } catch (error) {
          if (isMissing(error)) throw new ToolArgumentError("not_found", "rule_id", "No cart price rule with that ID: no codes were generated.");
          throw error;
        }
        if (stored.rule["coupon_type"] !== "AUTO" && stored.rule["use_auto_generation"] !== true) {
          throw new ToolArgumentError("invalid_argument", "rule_id", `That rule does not take generated codes: set its coupon_type to AUTO with ${UPDATE_SALES_RULE_TOOL} first.`);
        }
        const write = track();
        const answer = await write.client.post("/coupons/generate", {
          couponSpec: { rule_id: ruleId, quantity: qty, length: length ?? 12, format: format ?? "alphanum", ...(prefix !== undefined ? { prefix } : {}) },
        });
        const codes = Array.isArray(answer) ? answer.filter((code): code is string => typeof code === "string") : [];
        return { rule_id: ruleId, codes, provenance: provenanceOf(write.answers) };
      },
    }),
  ];
}
