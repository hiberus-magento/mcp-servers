// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Category tools: four reads and four writes, ported from the original
// `src/tools/categories.js`, with the usual differences (encoded paths,
// validated criteria, bounded pages, allowlisted results).
//
// One shape change is forced rather than chosen. `GET /categories` returns a
// RECURSIVE tree (`children_data` inside `children_data`), which a fixed
// allowlist cannot describe. `magentorest_get_category_tree` therefore returns
// it FLATTENED: one node per category carrying `parent_id` and `level`, so the
// structure is preserved, with a hard cap of 500 nodes and a `truncated` flag
// instead of a catalog-sized tree. The walk is iterative, so a pathologically
// deep response cannot overflow the stack.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf, pagedListOf } from "./shapes.js";

const LIST_PAGE_SIZE = 20;
const MAX_TREE_NODES = 500;

function flattenCategoryTree(root: unknown): { readonly items: readonly unknown[]; readonly total_count: number; readonly truncated: boolean } {
  const items: unknown[] = [];
  let total = 0;
  const stack: unknown[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node === null || typeof node !== "object") {
      continue;
    }
    total += 1;
    const record = node as Record<string, unknown>;
    if (items.length < MAX_TREE_NODES) {
      items.push(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "children_data")));
    }
    const children = record["children_data"];
    if (Array.isArray(children)) {
      // Reversed, so popping visits the children in their original order.
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
    }
  }
  return { items, total_count: total, truncated: total > items.length };
}

const prose = (code: string, value: string | undefined): { attribute_code: string; value: string }[] =>
  value === undefined ? [] : [{ attribute_code: code, value }];

export function categoryTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_category_tree",
      description:
        "Use this to read the category structure under a root category as a flat list: each node has its id, parent_id, name, level, position, product count and whether it is active. Capped at 500 nodes; truncated says when the cap cut it short.",
      input: z.object({ root_category_id: entityId("root category to start from (default 1)").optional() }).strict(),
      shape: pagedListOf(shapes.category_tree_node),
      run: async ({ root_category_id }, client) =>
        flattenCategoryTree(await client.get("/categories", new URLSearchParams({ rootCategoryId: String(root_category_id ?? 1) }).toString())),
    }),

    readTool({
      name: "magentorest_get_category_by_id",
      description: "Use this to read one category by its numeric ID: name, parent, level, position, product count, children, URL path and catalog attributes.",
      input: z.object({ category_id: entityId("category") }).strict(),
      shape: shapes.category,
      run: ({ category_id }, client) => client.get(restPath`/categories/${category_id}`),
    }),

    readTool({
      name: "magentorest_list_categories",
      description: "Use this to find categories, optionally by parent, by a phrase in the name, or by active status. Returns a bounded page and the total count.",
      input: z
        .object({
          parent_id: entityId("parent category to filter by").optional(),
          name: z.string().min(1).max(200).optional().describe("Text the category name must contain."),
          is_active: z.boolean().optional().describe("Filter by active status."),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes.category),
      run: async ({ parent_id, name, is_active, page_size, current_page }, client) => {
        // One filter per group: groups are AND'd, which is what these three mean.
        const groups: SearchFilter[][] = [];
        if (parent_id !== undefined) {
          groups.push([{ field: "parent_id", value: parent_id }]);
        }
        if (name !== undefined) {
          groups.push([{ field: "name", value: `%${name}%`, conditionType: "like" }]);
        }
        if (is_active !== undefined) {
          groups.push([{ field: "is_active", value: is_active ? 1 : 0 }]);
        }
        const result = await client.search("/categories/list", { filterGroups: groups, pageSize: page_size ?? LIST_PAGE_SIZE, currentPage: current_page ?? 1 });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_products_in_category",
      description: "Use this to list the products assigned to one category. Returns a bounded page of product summaries (id, sku, name, price, status, type) and the total count.",
      input: z.object({ category_id: entityId("category"), page_size: pageSize, current_page: currentPage }).strict(),
      shape: listOf(shapes.product_summary),
      run: async ({ category_id, page_size, current_page }, client) => {
        const result = await client.search("/products", {
          filterGroups: [[{ field: "category_id", value: category_id }]],
          pageSize: page_size ?? LIST_PAGE_SIZE,
          currentPage: current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    writeTool({
      name: "magentorest_create_category",
      description: "Use this to create a category under a parent. Adds a record; it does not assign any product to it.",
      effect: "create",
      input: z
        .object({
          name: z.string().min(1).max(255).describe("Category name."),
          parent_id: entityId("parent category"),
          is_active: z.boolean().optional().describe("Whether the category is active (default true)."),
          include_in_menu: z.boolean().optional().describe("Include in the navigation menu (default true)."),
          description: z.string().max(65_535).optional().describe("Category description."),
          url_key: z.string().max(255).optional().describe("URL key."),
        })
        .strict(),
      shape: shapes.category,
      run: (args, client) =>
        client.post("/categories", {
          category: {
            name: args.name,
            parent_id: args.parent_id,
            is_active: args.is_active ?? true,
            include_in_menu: args.include_in_menu ?? true,
            custom_attributes: [...prose("description", args.description), ...prose("url_key", args.url_key)],
          },
        }),
    }),

    writeTool({
      name: "magentorest_update_category",
      description: "Use this to change fields of an existing category. Only the fields you pass are sent; at least one is required. Overwrites the current values.",
      effect: "update",
      input: z
        .object({
          category_id: entityId("category to update"),
          name: z.string().min(1).max(255).optional().describe("New category name."),
          is_active: z.boolean().optional().describe("Whether the category is active."),
          include_in_menu: z.boolean().optional().describe("Include in the navigation menu."),
          description: z.string().max(65_535).optional().describe("New description."),
          position: z.number().int().min(0).optional().describe("Sort position."),
        })
        .strict(),
      shape: shapes.category,
      run: ({ category_id, description, ...fields }, client) => {
        const attributes = prose("description", description);
        const direct = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (Object.keys(direct).length === 0 && attributes.length === 0) {
          throw new Error("magentorest_update_category: nothing to update — pass at least one field besides the category ID.");
        }
        return client.put(restPath`/categories/${category_id}`, { category: { ...direct, ...(attributes.length > 0 ? { custom_attributes: attributes } : {}) } });
      },
    }),

    writeTool({
      name: "magentorest_delete_category",
      description: "Use this to permanently delete a category and its subcategories by ID. Irreversible; the products stay in the catalog but lose the assignment.",
      effect: "delete",
      input: z.object({ category_id: entityId("category to delete") }).strict(),
      shape: [],
      run: ({ category_id }, client) => client.delete(restPath`/categories/${category_id}`),
    }),

    writeTool({
      name: "magentorest_move_category",
      description: "Use this to move a category under a different parent, optionally right after a sibling. Changes the category tree and the URL paths below it.",
      effect: "update",
      input: z
        .object({
          category_id: entityId("category to move"),
          parent_id: entityId("new parent category"),
          after_id: entityId("sibling category it should follow").optional(),
        })
        .strict(),
      shape: [],
      run: ({ category_id, parent_id, after_id }, client) =>
        client.put(restPath`/categories/${category_id}/move`, { parentId: parent_id, ...(after_id !== undefined ? { afterId: after_id } : {}) }),
    }),
  ];
}
