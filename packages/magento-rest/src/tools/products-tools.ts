// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Product tools. Three reads and six writes, ported from the original
// `src/tools/products.js` with these deliberate differences:
//
//   - every path segment goes through `restPath` (the original interpolated a
//     SKU raw, so `a/../../customers` re-addressed the request);
//   - every list is bounded (`page_size` 1..100) and every field name that
//     becomes part of a query key is validated, not spliced;
//   - results are projected through an allowlist (`shapes.ts`), not returned
//     whole, and `extension_attributes` is no longer passed through;
//   - `update_product_attribute` takes a primitive value, not `z.any()`, and
//     refuses the identity attributes (`sku`, `id`, `entity_id`, `type_id`):
//     renaming a SKU or retyping a product through a "set one attribute"
//     tool is not what that tool is for.
//
// The writes are only registered when `MAGENTO_REST_ALLOW_WRITES=true`
// (`tools/index.ts`); this module defines them either way.
import { z } from "zod";
import { restPath } from "../client/index.js";
import { conditionType, currentPage, entityId, fieldName, pageSize, sku, sortDirection, DEFAULT_SEARCH_PAGE_SIZE } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const IDENTITY_ATTRIBUTES: ReadonlySet<string> = new Set(["sku", "id", "entity_id", "type_id"]);

const primitiveValue = z.union([z.string(), z.number(), z.boolean()]);

const prose = (code: string, value: string | undefined): { attribute_code: string; value: string }[] =>
  value === undefined ? [] : [{ attribute_code: code, value }];

export function productTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_product_by_sku",
      description: "Use this to read one product by its SKU: name, price, status, visibility, type, timestamps, catalog attributes and category links.",
      input: z.object({ sku }).strict(),
      shape: shapes.product,
      run: ({ sku }, client) => client.get(restPath`/products/${sku}`),
    }),

    readTool({
      name: "magentorest_search_products",
      description: "Use this to find products whose name contains a phrase. Returns a bounded page of summaries (id, sku, name, price, status, type) and the total count.",
      input: z.object({ query: z.string().min(1).max(200).describe("Text the product name must contain."), page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.product_summary),
      run: async ({ query, page_size, current_page }, client) => {
        const result = await client.search("/products", {
          filterGroups: [[{ field: "name", value: `%${query}%`, conditionType: "like" }]],
          pageSize: page_size ?? DEFAULT_SEARCH_PAGE_SIZE,
          currentPage: current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_advanced_product_search",
      description:
        "Use this to filter products on one field with a chosen comparison (eq, like, gt, gteq, lt, lteq, in, ...) and sort the result. Returns a bounded page of summaries and the total count.",
      input: z
        .object({
          field: fieldName("Product field to filter on, e.g. sku, price, status."),
          value: z.string().max(200).describe("Value to compare against."),
          condition_type: conditionType,
          page_size: pageSize,
          current_page: currentPage,
          sort_field: fieldName("Field to sort by (default entity_id).").optional(),
          sort_direction: sortDirection,
        })
        .strict(),
      shape: listOf(shapes.product_summary),
      run: async (args, client) => {
        const result = await client.search("/products", {
          filterGroups: [[{ field: args.field, value: args.value, conditionType: args.condition_type ?? "eq" }]],
          pageSize: args.page_size ?? DEFAULT_SEARCH_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
          sort: { field: args.sort_field ?? "entity_id", direction: args.sort_direction ?? "DESC" },
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    writeTool({
      name: "magentorest_create_product",
      description: "Use this to create a new product. Adds a catalog record; the SKU must be unique. Does not touch stock or categories.",
      effect: "create",
      input: z
        .object({
          sku,
          name: z.string().min(1).max(255).describe("Product name."),
          price: z.number().min(0).describe("Product price."),
          attribute_set_id: z.number().int().min(1).optional().describe("Attribute set ID (default 4, the Default set)."),
          type_id: z.enum(["simple", "configurable", "grouped", "virtual", "bundle", "downloadable"]).optional().describe("Product type (default simple)."),
          status: z.union([z.literal(1), z.literal(2)]).optional().describe("1 = enabled, 2 = disabled (default 1)."),
          visibility: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe("1 not visible, 2 catalog, 3 search, 4 catalog and search (default 4)."),
          weight: z.number().min(0).optional().describe("Product weight."),
          description: z.string().max(65_535).optional().describe("Full description."),
          short_description: z.string().max(65_535).optional().describe("Short description."),
          meta_title: z.string().max(255).optional().describe("SEO meta title."),
          meta_description: z.string().max(1000).optional().describe("SEO meta description."),
          url_key: z.string().max(255).optional().describe("URL key."),
        })
        .strict(),
      shape: shapes.product,
      run: (args, client) =>
        client.post("/products", {
          product: {
            sku: args.sku,
            name: args.name,
            price: args.price,
            attribute_set_id: args.attribute_set_id ?? 4,
            type_id: args.type_id ?? "simple",
            status: args.status ?? 1,
            visibility: args.visibility ?? 4,
            ...(args.weight !== undefined ? { weight: args.weight } : {}),
            custom_attributes: [
              ...prose("description", args.description),
              ...prose("short_description", args.short_description),
              ...prose("meta_title", args.meta_title),
              ...prose("meta_description", args.meta_description),
              ...prose("url_key", args.url_key),
            ],
          },
        }),
    }),

    writeTool({
      name: "magentorest_update_product",
      description: "Use this to change fields of an existing product. Only the fields you pass are sent; at least one is required. Overwrites the current values.",
      effect: "update",
      input: z
        .object({
          sku,
          name: z.string().min(1).max(255).optional().describe("New product name."),
          price: z.number().min(0).optional().describe("New price."),
          status: z.union([z.literal(1), z.literal(2)]).optional().describe("1 = enabled, 2 = disabled."),
          visibility: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe("1 not visible, 2 catalog, 3 search, 4 catalog and search."),
          weight: z.number().min(0).optional().describe("New weight."),
          description: z.string().max(65_535).optional().describe("New full description."),
          short_description: z.string().max(65_535).optional().describe("New short description."),
        })
        .strict(),
      shape: shapes.product,
      run: ({ sku, description, short_description, ...fields }, client) => {
        const attributes = [...prose("description", description), ...prose("short_description", short_description)];
        const direct = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (Object.keys(direct).length === 0 && attributes.length === 0) {
          throw new Error("magentorest_update_product: nothing to update — pass at least one field besides the SKU.");
        }
        return client.put(restPath`/products/${sku}`, { product: { ...direct, ...(attributes.length > 0 ? { custom_attributes: attributes } : {}) } });
      },
    }),

    writeTool({
      name: "magentorest_update_product_attribute",
      description:
        "Use this to set ONE attribute of a product by code (name, price, status, description, a custom attribute, ...). Overwrites the current value. The identity attributes sku, id, entity_id and type_id are refused.",
      effect: "update",
      input: z.object({ sku, attribute_code: fieldName("Attribute code to set, e.g. price or url_key."), value: primitiveValue.describe("New value: a string, number or boolean.") }).strict(),
      shape: shapes.product,
      run: async ({ sku, attribute_code, value }, client) => {
        if (IDENTITY_ATTRIBUTES.has(attribute_code)) {
          throw new Error(`magentorest_update_product_attribute: "${attribute_code}" is an identity attribute and cannot be changed here.`);
        }
        const current = await client.get(restPath`/products/${sku}`);
        const customs =
          current !== null && typeof current === "object" && "custom_attributes" in current && Array.isArray(current.custom_attributes) ? (current.custom_attributes as unknown[]) : [];
        const isCustom = customs.some((entry) => entry !== null && typeof entry === "object" && "attribute_code" in entry && entry.attribute_code === attribute_code);
        return client.put(restPath`/products/${sku}`, {
          product: isCustom ? { custom_attributes: [{ attribute_code, value }] } : { [attribute_code]: value },
        });
      },
    }),

    writeTool({
      name: "magentorest_delete_product",
      description: "Use this to permanently delete a product by SKU. Irreversible: the product, its images and its URL rewrites are removed.",
      effect: "delete",
      input: z.object({ sku }).strict(),
      shape: [],
      run: ({ sku }, client) => client.delete(restPath`/products/${sku}`),
    }),

    writeTool({
      name: "magentorest_assign_product_to_category",
      description: "Use this to add a product to a category at a position. Adds a link; it does not move the product out of other categories.",
      effect: "create",
      input: z.object({ category_id: entityId("category"), sku, position: z.number().int().min(0).optional().describe("Position within the category (default 0).") }).strict(),
      shape: [],
      run: ({ category_id, sku, position }, client) =>
        client.post(restPath`/categories/${category_id}/products`, { productLink: { sku, category_id, position: position ?? 0 } }),
    }),

    writeTool({
      name: "magentorest_remove_product_from_category",
      description: "Use this to remove a product from one category. The product itself and its other category links are kept.",
      effect: "delete",
      input: z.object({ category_id: entityId("category"), sku }).strict(),
      shape: [],
      run: ({ category_id, sku }, client) => client.delete(restPath`/categories/${category_id}/products/${sku}`),
    }),
  ];
}
