// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Product attribute tools: five reads and one write, ported from the original
// `src/tools/attributes.js`. An attribute code is placed in a URL path, so it is
// a closed shape here (lowercase letters, digits and underscores, starting with
// a letter, at most 60) — the original interpolated it raw. Otherwise it is the
// usual: encoded paths, validated criteria, bounded pages, allowlisted results.
//
// `add_attribute_option` cannot mark the new option as the default: the
// original always sent `is_default: false`, and the tool never took the
// argument, so the strict schema keeps it that way.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 50;

const attributeCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,59}$/, "lowercase letters, digits and underscores, starting with a letter (max 60)")
  .describe("The attribute code, e.g. color, size, manufacturer.");

export function attributeTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_product_attribute",
      description: "Use this to read one product attribute by code: its input type, scope, flags (required, searchable, filterable, comparable), options and store labels.",
      input: z.object({ attribute_code: attributeCode }).strict(),
      shape: shapes.product_attribute,
      run: ({ attribute_code }, client) => client.get(restPath`/products/attributes/${attribute_code}`),
    }),

    readTool({
      name: "magentorest_search_product_attributes",
      description:
        "Use this to find product attributes by part of the code, input type (text, select, multiselect, boolean, ...), or the searchable and filterable flags. Filters are combined with AND. Returns a bounded page of summaries and the total count.",
      input: z
        .object({
          attribute_code: z.string().regex(/^[a-z0-9_]{1,60}$/, "lowercase letters, digits and underscores").optional().describe("Text the attribute code must contain."),
          frontend_input: z.string().regex(/^[a-z_]{1,32}$/, "lowercase letters and underscores").optional().describe("Input type, e.g. text, textarea, select, multiselect, boolean, price."),
          is_searchable: z.boolean().optional().describe("Filter by the searchable flag."),
          is_filterable: z.boolean().optional().describe("Filter by the filterable flag."),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes.product_attribute_summary),
      run: async (args, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (args.attribute_code !== undefined) filters.push({ field: "attribute_code", value: `%${args.attribute_code}%`, conditionType: "like" });
        if (args.frontend_input !== undefined) filters.push({ field: "frontend_input", value: args.frontend_input });
        if (args.is_searchable !== undefined) filters.push({ field: "is_searchable", value: args.is_searchable ? 1 : 0 });
        if (args.is_filterable !== undefined) filters.push({ field: "is_filterable", value: args.is_filterable ? 1 : 0 });
        const result = await client.search("/products/attributes", {
          filterGroups: filters.map((filter) => [filter]),
          pageSize: args.page_size ?? LIST_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_attribute_options",
      description: "Use this to list the options of a select or multiselect attribute as label and value pairs.",
      input: z.object({ attribute_code: attributeCode }).strict(),
      shape: shapes.attribute_option,
      run: async ({ attribute_code }, client) => {
        const options = await client.get(restPath`/products/attributes/${attribute_code}/options`);
        return Array.isArray(options) ? options : [];
      },
    }),

    readTool({
      name: "magentorest_get_attribute_sets",
      description: "Use this to list the product attribute sets with their ID, name and sort order. Returns a bounded page and the total count.",
      input: z.object({ page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.attribute_set),
      run: async ({ page_size, current_page }, client) => {
        const result = await client.search("/products/attribute-sets/sets/list", { pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_attribute_set_attributes",
      description: "Use this to list the attributes that belong to one attribute set, as summaries (code, input type, label, required, searchable, filterable).",
      input: z.object({ attribute_set_id: entityId("attribute set") }).strict(),
      shape: shapes.product_attribute_summary,
      run: async ({ attribute_set_id }, client) => {
        const attributes = await client.get(restPath`/products/attribute-sets/${attribute_set_id}/attributes`);
        return Array.isArray(attributes) ? attributes : [];
      },
    }),

    writeTool({
      name: "magentorest_add_attribute_option",
      description: "Use this to add an option to a select or multiselect attribute. Adds an option that is not the default; it does not assign it to any product.",
      effect: "create",
      input: z
        .object({
          attribute_code: attributeCode,
          label: z.string().min(1).max(255).describe("Option label."),
          sort_order: z.number().int().min(0).optional().describe("Sort order (default 0)."),
        })
        .strict(),
      shape: [],
      run: ({ attribute_code, label, sort_order }, client) =>
        client.post(restPath`/products/attributes/${attribute_code}/options`, { option: { label, sort_order: sort_order ?? 0, is_default: false } }),
    }),
  ];
}
