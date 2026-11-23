// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Typed `filters` and `sort` for the list tools that read through Magento's searchCriteria.
//
// Each tool names the columns a caller may filter and sort on, by Magento's own name for them (`entity_id`, not the
// `id` a result shows). The list is closed: a field is an enum value, never free text, so it cannot address another
// criterion, and a column that identifies a customer is simply not on any list (`list-filters.test.ts` walks every
// tool to pin that; a host cannot see enum values, so this is the only place that guarantee lives).
//
// Every filter goes in its own filter group, and Magento ANDs groups. A tool's own inputs (`status`, `date_from`, ...)
// are their own groups too, so a generic filter and a bespoke input on the same column are both applied: an
// impossible pair answers an empty page, never one of the two silently.
import { z } from "zod";
import { CONDITION_TYPES, type SearchFilter, type SortDirection } from "../client/index.js";

/** How many generic filters one call may carry. */
export const MAX_LIST_FILTERS = 10;

/** How many values an `in` or `nin` filter may carry. */
const MAX_LIST_VALUES = 100;

const text = z.string().max(255);
const scalar = z.union([text, z.number(), z.boolean()]);
// Magento splits an `in` value on commas, so a value inside the list cannot hold one.
const listValue = z.union([text.regex(/^[^,]*$/, "no commas inside an in/nin value"), z.number()]);

const LIST_CONDITIONS = new Set(["in", "nin"]);
const VALUELESS_CONDITIONS = new Set(["null", "notnull"]);

export type FieldList = readonly [string, ...string[]];

export interface ListFilter {
  readonly field: string;
  readonly condition?: (typeof CONDITION_TYPES)[number] | undefined;
  readonly value?: string | number | boolean | readonly (string | number)[] | undefined;
}

export interface ListSort {
  readonly field: string;
  readonly direction?: SortDirection | undefined;
}

const FILTERS_DESCRIPTION = `Narrow the list. Each entry compares one field; entries are combined with AND (at most ${MAX_LIST_FILTERS}). Conditions: eq (default), neq, like and nlike (% is the wildcard), in and nin (value is an array), gt, gteq, lt, lteq, from, to, null and notnull (no value), finset. Dates compare as text, e.g. 2026-01-31 or 2026-01-31 23:59:59.`;

/** The `filters` and `sort` inputs over one tool's columns. Spread them into the tool's input object. */
export function listInputs<F extends FieldList>(fields: F) {
  const field = z.enum(fields);
  const filter = z
    .object({
      field: field.describe("Column to compare."),
      condition: z.enum(CONDITION_TYPES).optional().describe("Comparison (default eq)."),
      value: z.union([scalar, z.array(listValue).min(1).max(MAX_LIST_VALUES)]).optional().describe("Value to compare against: an array for in and nin, nothing for null and notnull."),
    })
    .strict()
    .superRefine((entry, context) => {
      const condition = entry.condition ?? "eq";
      const problem = VALUELESS_CONDITIONS.has(condition)
        ? entry.value !== undefined && `${condition} takes no value`
        : LIST_CONDITIONS.has(condition)
          ? !Array.isArray(entry.value) && `${condition} takes an array of values`
          : (entry.value === undefined || Array.isArray(entry.value)) && `${condition} takes one value`;
      if (problem !== false) context.addIssue({ code: "custom", path: ["value"], message: problem });
    });
  return {
    filters: z.array(filter).max(MAX_LIST_FILTERS).optional().describe(FILTERS_DESCRIPTION),
    sort: z
      .object({ field: field.describe("Column to sort by."), direction: z.enum(["ASC", "DESC"]).optional().describe("Sort direction (default DESC).") })
      .strict()
      .optional()
      .describe("Order of the results, on one of the same columns."),
  };
}

function wireValue(value: ListFilter["value"]): string | number {
  if (value === undefined) return 1; // null and notnull ignore it, but Magento needs one to build the filter.
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.join(",");
  return value as string | number;
}

/** One filter group per filter: Magento ANDs groups. */
export function genericFilterGroups(filters: readonly ListFilter[] | undefined): SearchFilter[][] {
  return (filters ?? []).map((filter) => [{ field: filter.field, value: wireValue(filter.value), conditionType: filter.condition ?? "eq" }]);
}

/** The caller's sort (descending unless told otherwise), or the tool's own order when there is none. */
export function genericSort(sort: ListSort | undefined, fallback: { readonly field: string; readonly direction: SortDirection } | undefined): { field: string; direction: SortDirection } | undefined {
  if (sort !== undefined) return { field: sort.field, direction: sort.direction ?? "DESC" };
  return fallback === undefined ? undefined : { ...fallback };
}

/** The searchCriteria a list tool sends: its own filter groups, then the generic ones (all ANDed), and the sort. */
export function listCriteria(
  args: { readonly filters?: readonly ListFilter[] | undefined; readonly sort?: ListSort | undefined },
  own: { readonly filterGroups?: readonly SearchFilter[][]; readonly sort?: { readonly field: string; readonly direction: SortDirection } } = {},
): { filterGroups: SearchFilter[][]; sort?: { field: string; direction: SortDirection } } {
  const sort = genericSort(args.sort, own.sort);
  return { filterGroups: [...(own.filterGroups ?? []), ...genericFilterGroups(args.filters)], ...(sort !== undefined ? { sort } : {}) };
}

/**
 * The columns each list tool filters and sorts on, by Magento's name for them. None identifies a customer
 * (`list-filters.test.ts` checks every tool against `isPersonalField`). Sales rules leave out from_date and to_date:
 * on Adobe Commerce the staging module owns those dates, and filtering on them is not verified there.
 */
export const LIST_FIELDS = {
  product: ["entity_id", "sku", "name", "price", "status", "visibility", "type_id", "attribute_set_id", "weight", "created_at", "updated_at"],
  category: ["entity_id", "parent_id", "name", "is_active", "position", "level", "include_in_menu", "created_at", "updated_at"],
  customer_group: ["id", "code", "tax_class_id", "tax_class_name"],
  order: ["entity_id", "increment_id", "status", "state", "store_id", "customer_is_guest", "order_currency_code", "base_currency_code", "subtotal", "tax_amount", "discount_amount", "shipping_amount", "grand_total", "total_qty_ordered", "total_paid", "total_refunded", "coupon_code", "created_at", "updated_at"],
  invoice: ["entity_id", "order_id", "increment_id", "state", "grand_total", "subtotal", "tax_amount", "shipping_amount", "discount_amount", "total_qty", "order_currency_code", "created_at", "updated_at"],
  shipment: ["entity_id", "order_id", "increment_id", "total_qty", "total_weight", "created_at", "updated_at"],
  creditmemo: ["entity_id", "order_id", "increment_id", "state", "grand_total", "subtotal", "tax_amount", "shipping_amount", "adjustment", "order_currency_code", "created_at", "updated_at"],
  cart: ["entity_id", "store_id", "is_active", "is_virtual", "items_count", "items_qty", "customer_is_guest", "grand_total", "subtotal", "quote_currency_code", "created_at", "updated_at"],
  cms_block: ["block_id", "identifier", "title", "is_active", "creation_time", "update_time"],
  cms_page: ["page_id", "identifier", "title", "is_active", "page_layout", "sort_order", "creation_time", "update_time"],
  product_attribute: ["attribute_id", "attribute_code", "frontend_input", "backend_type", "is_required", "is_user_defined", "is_unique", "is_searchable", "is_filterable", "is_filterable_in_search", "is_comparable", "is_visible_on_front", "used_in_product_listing", "used_for_sort_by"],
  attribute_set: ["attribute_set_id", "attribute_set_name", "sort_order", "entity_type_id"],
  inventory_source: ["source_code", "name", "enabled", "country_id", "region_id", "city", "postcode", "priority"],
  inventory_stock: ["stock_id", "name"],
  source_item: ["sku", "source_code", "quantity", "status"],
  sales_rule: ["rule_id", "name", "is_active", "sort_order", "simple_action", "discount_amount", "coupon_type", "times_used", "uses_per_customer", "stop_rules_processing", "apply_to_shipping"],
  coupon: ["coupon_id", "rule_id", "code", "usage_limit", "usage_per_customer", "times_used", "expiration_date", "is_primary", "created_at", "type"],
  tax_rate: ["tax_calculation_rate_id", "code", "rate", "tax_country_id", "tax_region_id", "tax_postcode", "zip_is_range", "zip_from", "zip_to"],
  tax_rule: ["id", "code", "priority", "position", "calculate_subtotal", "tax_rate_ids", "customer_tax_class_ids", "product_tax_class_ids"],
  tax_class: ["class_id", "class_name", "class_type"],
} as const satisfies Record<string, FieldList>;
