// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Order tools: five reads and four writes, ported from the original
// `src/tools/orders.js`. Beyond the usual encoded paths, validated criteria and
// bounded pages, the differences are about what an order holds:
//
//   - results are totals, state, the customer as the order records it, and the
//     lines — NOT the billing/shipping addresses, the payment block or the
//     extension attributes the original returned whole. Addresses can be added
//     in a reviewed MAGENTO_REST_FIELDS_FILE; payment never can (the floor);
//   - `sort_field` / `sort_direction` were spliced raw into the query and
//     `status` was never constrained; each is now a closed shape;
//   - an order that does not exist is a not-found ERROR, where the original
//     returned a normal-looking sentence an agent could mistake for a result;
//   - there is no `get_order_statuses`: the original called `/orders/statuses`,
//     which a live Magento 2.4.8 answers 400 ("The \"statuses\" value's type is
//     invalid. The \"int\" type was expected.") because it reads that path as
//     `/orders/{id}` with an id of "statuses". No such collection route exists;
//
// The four writes change real state. Cancel, hold and unhold are `action`
// effects (destructive, not idempotent). `add_order_comment` can EMAIL the
// customer when `is_customer_notified` is true — outward-facing, so its
// description says so — and defaults to silent.
import { z } from "zod";
import { MagentoRestError, restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, fieldName, isoDate, pageSize, sortDirection } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 20;

/** An order status CODE (`pending`, `holded`, `payment_review`): lowercase, digits, underscore. */
const statusCode = (what: string) =>
  z
    .string()
    .regex(/^[a-z0-9_]{1,32}$/, "lowercase letters, digits and underscores only")
    .describe(what);

/** An order number: letters, digits and hyphens. A closed shape, so it can never carry a path or query. */
const incrementId = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,32}$/, "letters, digits and hyphens only (max 32)")
  .describe("The increment ID (order number) shown to the customer.");

const orderId = entityId("order (entity ID, not the order number)");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayField(record: unknown, key: string): unknown[] {
  if (isRecord(record)) {
    const value = record[key];
    return Array.isArray(value) ? value : [];
  }
  return [];
}

export function orderTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_order_by_id",
      description:
        "Use this to read one order by entity ID: status, state, totals, currency, the customer as the order records it, and the order lines. Billing and shipping addresses and payment details are not returned.",
      input: z.object({ order_id: orderId }).strict(),
      shape: shapes.order,
      run: ({ order_id }, client) => client.get(restPath`/orders/${order_id}`),
    }),

    readTool({
      name: "magentorest_get_order_by_increment_id",
      description: "Use this to read one order by its order number (increment ID), the one a customer quotes. Same fields as reading by entity ID. A number with no order is reported as not-found.",
      input: z.object({ increment_id: incrementId }).strict(),
      shape: shapes.order,
      run: async ({ increment_id }, client) => {
        const result = await client.search("/orders", { filterGroups: [[{ field: "increment_id", value: increment_id }]], pageSize: 1 });
        const first = result.items[0];
        if (first === undefined) {
          throw new MagentoRestError({ kind: "not-found", message: `No order found with increment ID ${increment_id}.`, status: 404 });
        }
        return first;
      },
    }),

    readTool({
      name: "magentorest_search_orders",
      description:
        "Use this to find orders by status, customer email or ID, creation date range (YYYY-MM-DD, whole days) and grand-total range. Filters are combined with AND. Newest first unless you sort otherwise. Returns a bounded page of summaries and the total count.",
      input: z
        .object({
          status: statusCode("Order status code, e.g. pending, processing, complete, canceled, holded.").optional(),
          customer_email: z.string().min(1).max(254).optional().describe("Exact customer email."),
          customer_id: entityId("customer to filter by").optional(),
          date_from: isoDate("Created on or after this day (YYYY-MM-DD).").optional(),
          date_to: isoDate("Created on or before this day (YYYY-MM-DD).").optional(),
          grand_total_min: z.number().min(0).optional().describe("Minimum grand total."),
          grand_total_max: z.number().min(0).optional().describe("Maximum grand total."),
          page_size: pageSize,
          current_page: currentPage,
          sort_field: fieldName("Field to sort by (default created_at).").optional(),
          sort_direction: sortDirection,
        })
        .strict(),
      shape: listOf(shapes.order_summary),
      run: async (args, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (args.status !== undefined) filters.push({ field: "status", value: args.status });
        if (args.customer_email !== undefined) filters.push({ field: "customer_email", value: args.customer_email });
        if (args.customer_id !== undefined) filters.push({ field: "customer_id", value: args.customer_id });
        if (args.date_from !== undefined) filters.push({ field: "created_at", value: `${args.date_from} 00:00:00`, conditionType: "gteq" });
        if (args.date_to !== undefined) filters.push({ field: "created_at", value: `${args.date_to} 23:59:59`, conditionType: "lteq" });
        if (args.grand_total_min !== undefined) filters.push({ field: "grand_total", value: args.grand_total_min, conditionType: "gteq" });
        if (args.grand_total_max !== undefined) filters.push({ field: "grand_total", value: args.grand_total_max, conditionType: "lteq" });
        const result = await client.search("/orders", {
          filterGroups: filters.map((filter) => [filter]),
          pageSize: args.page_size ?? LIST_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
          sort: { field: args.sort_field ?? "created_at", direction: args.sort_direction ?? "DESC" },
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_order_items",
      description: "Use this to list the lines of one order: SKU, name, quantities ordered, shipped, invoiced and refunded, price and row total, tax and discount.",
      input: z.object({ order_id: orderId }).strict(),
      shape: shapes.order_item,
      run: async ({ order_id }, client) => arrayField(await client.get(restPath`/orders/${order_id}`), "items"),
    }),

    readTool({
      name: "magentorest_get_order_comments",
      description: "Use this to read an order's status history: each entry's status, comment text, date and whether the customer was notified or can see it.",
      input: z.object({ order_id: orderId }).strict(),
      shape: shapes.order_status_history,
      run: async ({ order_id }, client) => arrayField(await client.get(restPath`/orders/${order_id}`), "status_histories"),
    }),

    writeTool({
      name: "magentorest_add_order_comment",
      description:
        "Use this to add a comment to an order's history, optionally moving it to another status. Silent and hidden from the customer unless you say otherwise: setting is_customer_notified to true makes Magento EMAIL the customer.",
      effect: "create",
      input: z
        .object({
          order_id: orderId,
          comment: z.string().min(1).max(2000).describe("The comment text."),
          status: statusCode("New status code, if this comment should also change the order's status.").optional(),
          is_customer_notified: z.boolean().optional().describe("Email the customer about this comment (default false)."),
          is_visible_on_front: z.boolean().optional().describe("Show the comment to the customer in their account (default false)."),
        })
        .strict(),
      shape: [],
      run: ({ order_id, comment, status, is_customer_notified, is_visible_on_front }, client) =>
        client.post(restPath`/orders/${order_id}/comments`, {
          statusHistory: {
            comment,
            is_customer_notified: is_customer_notified === true ? 1 : 0,
            is_visible_on_front: is_visible_on_front === true ? 1 : 0,
            parent_id: order_id,
            ...(status !== undefined ? { status } : {}),
          },
        }),
    }),

    writeTool({
      name: "magentorest_cancel_order",
      description: "Use this to cancel an order that has not been invoiced. Changes its state to canceled and releases the reserved stock; it cannot be undone from here.",
      effect: "action",
      input: z.object({ order_id: orderId }).strict(),
      shape: [],
      run: ({ order_id }, client) => client.post(restPath`/orders/${order_id}/cancel`),
    }),

    writeTool({
      name: "magentorest_hold_order",
      description: "Use this to put an order on hold, which stops it being invoiced or shipped until it is released with magentorest_unhold_order.",
      effect: "action",
      input: z.object({ order_id: orderId }).strict(),
      shape: [],
      run: ({ order_id }, client) => client.post(restPath`/orders/${order_id}/hold`),
    }),

    writeTool({
      name: "magentorest_unhold_order",
      description: "Use this to release an order from hold so it can be invoiced and shipped again.",
      effect: "action",
      input: z.object({ order_id: orderId }).strict(),
      shape: [],
      run: ({ order_id }, client) => client.post(restPath`/orders/${order_id}/unhold`),
    }),
  ];
}
