// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Stock and inventory tools: five reads and one write, ported from the
// original `src/tools/stock.js`. Differences beyond the usual encoded paths,
// bounded pages and allowlisted results:
//
//   - `get_low_stock_products` calls Magento's `/stockItems/lowStock` with the
//     parameters that endpoint documents (`scopeId`, `qty`, `pageSize`,
//     `currentPage`). The original sent `searchCriteria` filters, which that
//     endpoint does not read, so its threshold was probably never applied.
//     Items already at zero are therefore INCLUDED, where the original meant to
//     exclude them. UNVERIFIED against a live store, like every tool here;
//   - a warehouse (`get_inventory_sources`) comes back without its street,
//     phone, email or contact person;
//   - `update_product_stock` still targets the legacy stock item `1` of the
//     original, the default stock. Run against a live 2.4.8 with multi-source
//     inventory on, writing that quantity to 5 made the `default` SOURCE read 5
//     and changed no other source: the legacy item mirrors the default source
//     only. `get_source_items` reads every source; nothing here writes the others.
import { z } from "zod";
import { restPath } from "../client/index.js";
import { currentPage, pageSize, sku } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 50;
const FIXED_PAGE_SIZE = 100;

export function stockTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_product_stock",
      description: "Use this to read the stock item of one product by SKU: quantity, in-stock flag, whether stock is managed, sale quantity limits and backorder setting. With multi-source inventory enabled (the usual setup now) this legacy stock item mirrors only the default source, so it can show a null or zero quantity for a product held in other sources: use magentorest_get_source_items for every source.",
      input: z.object({ sku }).strict(),
      shape: shapes.stock_item,
      run: ({ sku }, client) => client.get(restPath`/stockItems/${sku}`),
    }),

    readTool({
      name: "magentorest_get_low_stock_products",
      description:
        "Use this to list stock items at or below a quantity threshold, for one stock scope. Items already at zero are included. Returns a bounded page and the total count. With multi-source inventory enabled (the usual setup now) this legacy stock item mirrors only the default source, so it can show a null or zero quantity for a product held in other sources: use magentorest_get_source_items for every source.",
      input: z
        .object({
          threshold: z.number().min(0).optional().describe("Quantity at or below which an item counts as low (default 10)."),
          scope_id: z.number().int().min(0).optional().describe("Stock scope (website) ID (default 0)."),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes.stock_item),
      run: async ({ threshold, scope_id, page_size, current_page }, client) =>
        client.get(
          "/stockItems/lowStock",
          new URLSearchParams({
            scopeId: String(scope_id ?? 0),
            qty: String(threshold ?? 10),
            pageSize: String(page_size ?? LIST_PAGE_SIZE),
            currentPage: String(current_page ?? 1),
          }).toString(),
        ),
    }),

    readTool({
      name: "magentorest_get_inventory_sources",
      description: "Use this to list the inventory sources (warehouses) of multi-source inventory: code, name, whether enabled, country, region, city, postcode and priority. Street, phone, email and contact person are not returned.",
      input: z.object({ page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.inventory_source),
      run: async ({ page_size, current_page }, client) => {
        const result = await client.search("/inventory/sources", { pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_inventory_stocks",
      description: "Use this to list the inventory stocks of multi-source inventory with the sales channels (websites) each one serves.",
      input: z.object({}).strict(),
      shape: listOf(shapes.inventory_stock),
      run: async (_args, client) => {
        const result = await client.search("/inventory/stocks", { pageSize: FIXED_PAGE_SIZE });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_source_items",
      description: "Use this to read a product's quantity and status in each inventory source, by SKU.",
      input: z.object({ sku }).strict(),
      shape: listOf(shapes.source_item),
      run: async ({ sku }, client) => {
        const result = await client.search("/inventory/source-items", { filterGroups: [[{ field: "sku", value: sku }]], pageSize: FIXED_PAGE_SIZE });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    writeTool({
      name: "magentorest_update_product_stock",
      description:
        "Use this to set a product's stock quantity on the default stock. The in-stock flag follows the quantity (in stock when above zero) unless you set it. Overwrites the current quantity. With multi-source inventory enabled this changes the quantity of the default source (observed on a live store) and no other source; magentorest_get_source_items reads every source, and nothing here writes the others.",
      effect: "update",
      input: z
        .object({
          sku,
          qty: z.number().min(0).describe("New quantity."),
          is_in_stock: z.boolean().optional().describe("Whether the product is in stock (default: true when qty is above 0)."),
        })
        .strict(),
      shape: [],
      // `1` is the default stock item, as in the original.
      run: ({ sku, qty, is_in_stock }, client) => client.put(restPath`/products/${sku}/stockItems/1`, { stockItem: { qty, is_in_stock: is_in_stock ?? qty > 0 } }),
    }),
  ];
}

