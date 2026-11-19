// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Cart (quote) tools: four reads, ported from the original `src/tools/carts.js`.
//
// Two of the original's six are deliberately NOT ported.
// `get_shipping_methods` and `get_payment_methods` call `/shipping-methods` and
// `/payment-methods`, which are not standard Magento REST endpoints — the
// available methods are per cart — and the first fell back to returning the
// store configuration, an answer to a different question than the one asked.
// Shipping a tool believed to be broken is worse than not shipping it; a
// per-cart replacement needs a live store to get right.
//
// A cart identifies its owner (id, name, email, group) but the billing and
// shipping addresses, date of birth and tax number are not returned.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, isoDate, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 20;
const ABANDONED_PAGE_SIZE = 50;
const MS_PER_DAY = 86_400_000;

const cartId = entityId("cart");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `YYYY-MM-DD HH:MM:SS` in UTC, the form Magento stores and compares. */
function magentoTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function describeAbandoned(cart: unknown): Record<string, unknown> {
  const record = isRecord(cart) ? cart : {};
  const customer = isRecord(record["customer"]) ? record["customer"] : undefined;
  const name = [text(customer?.["firstname"]), text(customer?.["lastname"])].filter((part) => part !== undefined).join(" ");
  return {
    cart_id: record["id"],
    customer_email: text(customer?.["email"]) ?? text(record["customer_email"]),
    customer_name: name !== "" ? name : "Guest",
    items_count: record["items_count"],
    grand_total: record["grand_total"],
    created_at: record["created_at"],
    updated_at: record["updated_at"],
  };
}

export function cartTools({ readTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_cart_by_id",
      description: "Use this to read one cart by ID: activity, item count and quantity, currency, the customer's identity (id, name, email, group) and the cart lines. Addresses are not returned.",
      input: z.object({ cart_id: cartId }).strict(),
      shape: shapes.cart,
      run: ({ cart_id }, client) => client.get(restPath`/carts/${cart_id}`),
    }),

    readTool({
      name: "magentorest_search_carts",
      description:
        "Use this to find carts by customer email or ID, active status and creation date range (YYYY-MM-DD, whole days). Filters are combined with AND. Returns a bounded page of summaries and the total count.",
      input: z
        .object({
          customer_email: z.string().min(1).max(254).optional().describe("Exact customer email."),
          customer_id: entityId("customer to filter by").optional(),
          is_active: z.boolean().optional().describe("Filter by active status."),
          created_at_from: isoDate("Created on or after this day (YYYY-MM-DD).").optional(),
          created_at_to: isoDate("Created on or before this day (YYYY-MM-DD).").optional(),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes.cart_summary),
      run: async (args, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (args.customer_email !== undefined) filters.push({ field: "customer_email", value: args.customer_email });
        if (args.customer_id !== undefined) filters.push({ field: "customer_id", value: args.customer_id });
        if (args.is_active !== undefined) filters.push({ field: "is_active", value: args.is_active ? 1 : 0 });
        if (args.created_at_from !== undefined) filters.push({ field: "created_at", value: `${args.created_at_from} 00:00:00`, conditionType: "gteq" });
        if (args.created_at_to !== undefined) filters.push({ field: "created_at", value: `${args.created_at_to} 23:59:59`, conditionType: "lteq" });
        const result = await client.search("/carts/search", {
          filterGroups: filters.map((filter) => [filter]),
          pageSize: args.page_size ?? LIST_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_cart_items",
      description: "Use this to list the lines of one cart: SKU, name, quantity, price and product type.",
      input: z.object({ cart_id: cartId }).strict(),
      shape: shapes.cart_item,
      run: async ({ cart_id }, client) => {
        const items = await client.get(restPath`/carts/${cart_id}/items`);
        return Array.isArray(items) ? items : [];
      },
    }),

    readTool({
      name: "magentorest_get_abandoned_carts",
      description:
        "Use this to find abandoned carts: active, non-empty carts not updated for at least a number of days, most recently updated first. Each entry names the owner (or Guest), the item count and the dates. Returns a bounded page, the total count and the cutoff used.",
      input: z
        .object({
          days_old: z.number().int().min(0).max(3650).optional().describe("Minimum days since the cart was last updated (default 7)."),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: [["items", shapes.abandoned_cart], "total_count", ["criteria", ["days_abandoned", "cutoff_date"]]],
      run: async ({ days_old, page_size, current_page }, client) => {
        const days = days_old ?? 7;
        const cutoff = magentoTimestamp(new Date(Date.now() - days * MS_PER_DAY));
        const result = await client.search("/carts/search", {
          filterGroups: [
            [{ field: "is_active", value: 1 }],
            [{ field: "updated_at", value: cutoff, conditionType: "lteq" }],
            [{ field: "items_count", value: 0, conditionType: "gt" }],
          ],
          pageSize: page_size ?? ABANDONED_PAGE_SIZE,
          currentPage: current_page ?? 1,
          sort: { field: "updated_at", direction: "DESC" },
        });
        return { total_count: result.totalCount, criteria: { days_abandoned: days, cutoff_date: cutoff }, items: result.items.map(describeAbandoned) };
      },
    }),
  ];
}
