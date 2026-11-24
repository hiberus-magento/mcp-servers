// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Promotion tools: four reads and one write, ported from the original
// `src/tools/promotions.js`. One difference worth stating: the original's
// `search_coupons` accepted an `is_active` filter and never used it, so a caller
// who set it got unfiltered results believing they were filtered. A coupon has
// no active flag to filter on, so the parameter is gone, and the strict schema
// now rejects it rather than ignoring it.
//
// A coupon CODE is redeemable by anyone who holds it. These are admin tools for
// the operator who manages promotions; the code is in the result because
// finding and inspecting codes is what they are for.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, isoDate, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";
import { LIST_FIELDS, listCriteria, listInputs } from "./list-filters.js";

const LIST_PAGE_SIZE = 50;

/** A real calendar day: `YYYY-MM-DD` that round-trips through a UTC date, so 2026-02-30 is refused. */
const activeOn = isoDate(
  "Keep only the rules whose stored dates span this day (YYYY-MM-DD): from date on or before it, and no to date or a to date on or after it. These are the dates the rule row stores; on Adobe Commerce with content staging a scheduled update may not show in them, so this is not a guarantee the rule applies on that day. Combined with AND with the other filters.",
).refine((day) => {
  // zod still runs this when the pattern failed, so an unparsable day must return false, not throw.
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
}, "expected a real calendar date");

/**
 * `from_date <= day AND (to_date IS NULL OR to_date >= day)`: groups are AND'd, filters inside a group OR'd.
 * Both columns are dates, and Magento compares them with the day as given.
 */
function storedDatesSpan(day: string): SearchFilter[][] {
  return [
    [{ field: "from_date", value: day, conditionType: "lteq" }],
    [
      { field: "to_date", value: 1, conditionType: "null" },
      { field: "to_date", value: day, conditionType: "gteq" },
    ],
  ];
}

export function promotionTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_sales_rules",
      description: "Use this to list the cart price rules (promotions): name, dates, whether active, discount type and amount, coupon type, usage limits, websites and customer groups. Returns a bounded page and the total count.",
      input: z.object({ active_on: activeOn.optional(), page_size: pageSize, current_page: currentPage, ...listInputs(LIST_FIELDS.sales_rule) }).strict(),
      shape: listOf(shapes.sales_rule),
      run: async ({ active_on, page_size, current_page, ...narrow }, client) => {
        const own = active_on === undefined ? undefined : { filterGroups: storedDatesSpan(active_on) };
        const result = await client.search("/salesRules/search", { ...listCriteria(narrow, own), pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_sales_rule_by_id",
      description: "Use this to read one cart price rule by ID: its dates, discount, coupon type, usage limits, websites and customer groups.",
      input: z.object({ rule_id: entityId("sales rule") }).strict(),
      shape: shapes.sales_rule,
      run: ({ rule_id }, client) => client.get(restPath`/salesRules/${rule_id}`),
    }),

    readTool({
      name: "magentorest_search_coupons",
      description: "Use this to find coupons by part of the code and by the rule they belong to. Filters are combined with AND. Returns a bounded page and the total count; each coupon shows its code, limits, times used and expiry.",
      input: z
        .object({
          code: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "letters, digits, _ and - only (max 64)").optional().describe("Text the coupon code must contain."),
          rule_id: entityId("sales rule to filter by").optional(),
          page_size: pageSize,
          current_page: currentPage,
          ...listInputs(LIST_FIELDS.coupon),
        })
        .strict(),
      shape: listOf(shapes.coupon),
      run: async ({ code, rule_id, page_size, current_page, ...narrow }, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (code !== undefined) filters.push({ field: "code", value: `%${code}%`, conditionType: "like" });
        if (rule_id !== undefined) filters.push({ field: "rule_id", value: rule_id });
        const result = await client.search("/coupons/search", {
          ...listCriteria(narrow, { filterGroups: filters.map((filter) => [filter]) }),
          pageSize: page_size ?? LIST_PAGE_SIZE,
          currentPage: current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_coupon_by_id",
      description: "Use this to read one coupon by ID: its code, rule, limits, times used and expiry.",
      input: z.object({ coupon_id: entityId("coupon") }).strict(),
      shape: shapes.coupon,
      run: ({ coupon_id }, client) => client.get(restPath`/coupons/${coupon_id}`),
    }),

    writeTool({
      name: "magentorest_delete_coupon",
      description: "Use this to permanently delete one coupon by ID. Irreversible: customers holding that code can no longer redeem it.",
      effect: "delete",
      input: z.object({ coupon_id: entityId("coupon to delete") }).strict(),
      shape: [],
      run: ({ coupon_id }, client) => client.delete(restPath`/coupons/${coupon_id}`),
    }),
  ];
}
