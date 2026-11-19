// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Invoices, shipments and credit memos: six reads and four writes, ported from
// the original `invoices.js`, `shipments.js` and `creditmemos.js`. These are
// the writes that move money or goods — capturing a payment, shipping a
// parcel, refunding — so three things differ from the original beyond the
// usual encoded paths, validated criteria and bounded pages:
//
//   - a refund's adjustments and shipping amount are sent inside `arguments`,
//     which is where Magento's refund endpoint reads them. The original put
//     them at the top level of the body, where (per Magento's documented
//     schema) they are ignored — on a refund that means money different from
//     the amount asked for, without an error. THIS IS UNVERIFIED against a
//     live store, like every tool here, and is why the tool is flagged so;
//   - a line list must be non-empty, at most 100 long, and every quantity
//     strictly positive. The original accepted `qty: 0` and `qty: -3`;
//   - `add_shipment_tracking` reads the shipment first and sends its `order_id`:
//     a live 2.4.8 answers the original's body 400 ("Could not save the shipment
//     tracking."), because the track row needs the order as well as the shipment;
//   - none of the writes is ever retried (the transport only retries reads),
//     because replaying one after an ambiguous failure could charge or refund
//     twice.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, isoDate, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf, type ResourceName } from "./shapes.js";

const LIST_PAGE_SIZE = 20;

const orderId = entityId("order (entity ID, not the order number)");

/** The order lines a document applies to. Non-empty, bounded, strictly positive quantities. */
const lineItems = z
  .array(z.object({ order_item_id: entityId("order line"), qty: z.number().positive().describe("Quantity; must be greater than zero.") }).strict())
  .min(1)
  .max(100);

const amount = (what: string) => z.number().min(0).describe(what);

interface DocumentSearch {
  readonly order_id?: number | undefined;
  readonly state?: number | undefined;
  readonly date_from?: string | undefined;
  readonly date_to?: string | undefined;
}

/** One filter per group: groups are AND'd, which is what these mean. Dates cover whole days. */
function documentFilters(args: DocumentSearch): SearchFilter[][] {
  const filters: SearchFilter[] = [];
  if (args.order_id !== undefined) filters.push({ field: "order_id", value: args.order_id });
  if (args.state !== undefined) filters.push({ field: "state", value: args.state });
  if (args.date_from !== undefined) filters.push({ field: "created_at", value: `${args.date_from} 00:00:00`, conditionType: "gteq" });
  if (args.date_to !== undefined) filters.push({ field: "created_at", value: `${args.date_to} 23:59:59`, conditionType: "lteq" });
  return filters.map((filter) => [filter]);
}

const baseSearchFields = {
  order_id: entityId("order to filter by").optional(),
  date_from: isoDate("Created on or after this day (YYYY-MM-DD).").optional(),
  date_to: isoDate("Created on or before this day (YYYY-MM-DD).").optional(),
  page_size: pageSize,
  current_page: currentPage,
};

const stateField = z.number().int().min(1).max(3).optional().describe("State: 1 = open, 2 = paid or refunded, 3 = canceled.");

export function salesDocumentTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  const getOne = (kind: string, idKey: string, path: (id: number) => string, shape: ResourceName, summary: string): MagentoRestTool =>
    readTool({
      name: `magentorest_get_${kind}_by_id`,
      description: `Use this to read one ${kind === "creditmemo" ? "credit memo (refund)" : kind} by its numeric ID: ${summary}`,
      input: z.object({ [idKey]: entityId(kind === "creditmemo" ? "credit memo" : kind) }).strict(),
      shape: shapes[shape],
      run: (args, client) => client.get(path(args[idKey] as number)),
    });

  const searchMany = (kind: string, label: string, path: string, shape: ResourceName, withState: boolean): MagentoRestTool =>
    readTool({
      name: `magentorest_search_${kind}s`,
      description: `Use this to find ${label} by order${withState ? ", state" : ""} and creation date range (YYYY-MM-DD, whole days). Filters are combined with AND. Returns a bounded page of summaries and the total count.`,
      input: z.object(withState ? { ...baseSearchFields, state: stateField } : baseSearchFields).strict(),
      shape: listOf(shapes[shape]),
      run: async (args, client) => {
        const result = await client.search(path, {
          filterGroups: documentFilters(args as DocumentSearch),
          pageSize: (args as { page_size?: number }).page_size ?? LIST_PAGE_SIZE,
          currentPage: (args as { current_page?: number }).current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    });

  return [
    getOne("invoice", "invoice_id", (id) => restPath`/invoices/${id}`, "invoice", "state, totals, currency and the invoiced lines."),
    searchMany("invoice", "invoices", "/invoices", "invoice_summary", true),
    getOne("shipment", "shipment_id", (id) => restPath`/shipment/${id}`, "shipment", "quantities, weight, the shipped lines and the tracking entries."),
    searchMany("shipment", "shipments", "/shipments", "shipment_summary", false),
    getOne("creditmemo", "creditmemo_id", (id) => restPath`/creditmemo/${id}`, "creditmemo", "state, totals, adjustments, currency and the refunded lines."),
    searchMany("creditmemo", "credit memos (refunds)", "/creditmemos", "creditmemo_summary", true),

    writeTool({
      name: "magentorest_create_invoice",
      description:
        "Use this to invoice an order, whole or by line. With capture set to true Magento CAPTURES the payment — the customer is charged; the default is false, which only records the invoice. Setting notify_customer to true emails the customer. Returns the new invoice ID.",
      effect: "action",
      input: z
        .object({
          order_id: orderId,
          capture: z.boolean().optional().describe("Capture the payment, charging the customer (default false)."),
          notify_customer: z.boolean().optional().describe("Email the customer (default false)."),
          items: lineItems.optional().describe("Lines to invoice; omit to invoice every line."),
        })
        .strict(),
      shape: [],
      run: ({ order_id, capture, notify_customer, items }, client) =>
        client.post(restPath`/order/${order_id}/invoice`, { capture: capture === true, notify: notify_customer === true, ...(items !== undefined ? { items } : {}) }),
    }),

    writeTool({
      name: "magentorest_create_shipment",
      description:
        "Use this to record a shipment for an order, whole or by line, optionally with tracking numbers. Setting notify_customer to true emails the customer. Returns the new shipment ID. Shipping deducts stock from the product's source: if a product has none there, Magento answers only \"Could not save a shipment\" (its log says the quantity is not available), so check stock first with magentorest_get_source_items.",
      effect: "action",
      input: z
        .object({
          order_id: orderId,
          notify_customer: z.boolean().optional().describe("Email the customer (default false)."),
          items: lineItems.optional().describe("Lines to ship; omit to ship every unshipped line."),
          tracks: z
            .array(
              z
                .object({
                  carrier_code: z.string().regex(/^[A-Za-z0-9_]{1,32}$/, "letters, digits and underscores only").describe("Carrier code, e.g. ups, fedex, dhl, custom."),
                  title: z.string().min(1).max(100).describe("Carrier name shown to the customer."),
                  track_number: z.string().min(1).max(100).describe("Tracking number."),
                })
                .strict(),
            )
            .min(1)
            .max(20)
            .optional()
            .describe("Tracking entries to add."),
        })
        .strict(),
      shape: [],
      run: ({ order_id, notify_customer, items, tracks }, client) =>
        client.post(restPath`/order/${order_id}/ship`, { notify: notify_customer === true, ...(items !== undefined ? { items } : {}), ...(tracks !== undefined ? { tracks } : {}) }),
    }),

    writeTool({
      name: "magentorest_add_shipment_tracking",
      description: "Use this to add a tracking number to an existing shipment. Adds an entry; it does not change the shipment's lines or notify the customer.",
      effect: "create",
      input: z
        .object({
          shipment_id: entityId("shipment"),
          carrier_code: z.string().regex(/^[A-Za-z0-9_]{1,32}$/, "letters, digits and underscores only").describe("Carrier code, e.g. ups, fedex, dhl, custom."),
          title: z.string().min(1).max(100).describe("Carrier name."),
          track_number: z.string().min(1).max(100).describe("Tracking number."),
        })
        .strict(),
      shape: shapes.shipment_track,
      run: async ({ shipment_id, carrier_code, title, track_number }, client) => {
        // The track row needs the shipment's `order_id` as well as its `parent_id`: without it a live
        // 2.4.8 answers 400 "Could not save the shipment tracking.", which is why the original's tool
        // never worked. The caller only has the shipment ID, so the shipment is read for its order.
        const shipment = await client.get(restPath`/shipment/${shipment_id}`);
        const orderId = shipment !== null && typeof shipment === "object" && "order_id" in shipment ? shipment.order_id : undefined;
        if (typeof orderId !== "number") {
          throw new Error("magentorest_add_shipment_tracking: the shipment does not report which order it belongs to, so a tracking entry cannot be saved.");
        }
        return client.post("/shipment/track", { entity: { carrier_code, title, track_number, parent_id: shipment_id, order_id: orderId } });
      },
    }),

    writeTool({
      name: "magentorest_create_creditmemo",
      description:
        "Use this to REFUND an order, whole or by line, with optional shipping and manual adjustments. Money goes back to the customer; it cannot be undone from here. Setting notify_customer to true emails the customer. Returns the new credit memo ID.",
      effect: "action",
      input: z
        .object({
          order_id: orderId,
          notify_customer: z.boolean().optional().describe("Email the customer (default false)."),
          items: lineItems.optional().describe("Lines to refund."),
          adjustment_positive: amount("Extra amount to refund on top of the lines (adjustment refund).").optional(),
          adjustment_negative: amount("Amount to withhold from the refund (adjustment fee).").optional(),
          shipping_amount: amount("Shipping amount to refund.").optional(),
        })
        .strict(),
      shape: [],
      run: ({ order_id, notify_customer, items, adjustment_positive, adjustment_negative, shipping_amount }, client) => {
        // These three belong inside `arguments` on Magento's refund endpoint.
        const args = {
          ...(adjustment_positive !== undefined ? { adjustment_positive } : {}),
          ...(adjustment_negative !== undefined ? { adjustment_negative } : {}),
          ...(shipping_amount !== undefined ? { shipping_amount } : {}),
        };
        return client.post(restPath`/order/${order_id}/refund`, {
          notify: notify_customer === true,
          ...(items !== undefined ? { items } : {}),
          ...(Object.keys(args).length > 0 ? { arguments: args } : {}),
        });
      },
    }),
  ];
}
