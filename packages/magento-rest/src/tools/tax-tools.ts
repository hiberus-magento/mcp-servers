// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Tax tools: three reads, ported from the original `src/tools/tax.js`. The tax
// class type was free text in the original; it is now the two values Magento
// defines, `CUSTOMER` and `PRODUCT`.
import { z } from "zod";
import type { SearchFilter } from "../client/index.js";
import { currentPage, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 100;

export function taxTools({ readTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_tax_rates",
      description: "Use this to list the tax rates: code, rate, country, region and postcode (or postcode range). Returns a bounded page and the total count.",
      input: z.object({ page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.tax_rate),
      run: async ({ page_size, current_page }, client) => {
        const result = await client.search("/taxRates/search", { pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_tax_rules",
      description: "Use this to list the tax rules: code, priority, and the customer tax classes, product tax classes and tax rates each one combines. Returns a bounded page and the total count.",
      input: z.object({ page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.tax_rule),
      run: async ({ page_size, current_page }, client) => {
        const result = await client.search("/taxRules/search", { pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_tax_classes",
      description: "Use this to list the tax classes, optionally only the CUSTOMER or only the PRODUCT ones. Returns one page of up to 100 and the total count.",
      input: z.object({ tax_class_type: z.enum(["CUSTOMER", "PRODUCT"]).optional().describe("Only classes of this type.") }).strict(),
      shape: listOf(shapes.tax_class),
      run: async ({ tax_class_type }, client) => {
        const filters: SearchFilter[][] = tax_class_type !== undefined ? [[{ field: "class_type", value: tax_class_type }]] : [];
        const result = await client.search("/taxClasses/search", { filterGroups: filters, pageSize: LIST_PAGE_SIZE });
        return { items: result.items, total_count: result.totalCount };
      },
    }),
  ];
}
