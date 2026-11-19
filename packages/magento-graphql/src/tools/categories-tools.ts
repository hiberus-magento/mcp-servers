// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf, uid } from "./inputs.js";

// The tree is three levels of children, fixed: depth is what Magento charges for, and an agent
// that needs a deeper branch asks again from that branch's uid.
const LEVEL = "uid name url_path product_count include_in_menu position";
const TREE = `
query GetCategoryTree($filters: CategoryFilterInput) {
  categories(filters: $filters) {
    items {
      ${LEVEL}
      children {
        ${LEVEL}
        children {
          ${LEVEL}
          children { ${LEVEL} }
        }
      }
    }
  }
}`;

const ONE = `
query GetCategory($filters: CategoryFilterInput) {
  categories(filters: $filters) {
    items {
      uid
      name
      url_key
      url_path
      url_suffix
      description
      meta_title
      meta_description
      display_mode
      product_count
      include_in_menu
      breadcrumbs { category_uid category_name category_url_path }
      children { uid name url_path product_count }
    }
  }
}`;

const NO_MATCH = "No category matches this uid or url_path in the storefront (it may be disabled or in another store view).";

const treeInput = z.object({ category_uid: uid("category to start from").optional().describe("Start below this category (its uid). Omit for the store's root category."), ...context }).strict();

const oneInput = z
  .object({ category_uid: uid("category").optional(), url_path: z.string().min(1).max(255).optional().describe("The category's URL path, e.g. gear/tents."), ...context })
  .strict()
  .refine((a) => (a.category_uid === undefined) !== (a.url_path === undefined), { message: "Give exactly one of category_uid and url_path." });

export function categoryTools({ readTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_get_category_tree",
      description: "Use this to read the storefront category tree — three levels from the store root, or from one category's uid: uid, name, URL path, product count and whether it is in the menu.",
      input: treeInput,
      document: TREE,
      pick: "categories",
      variables: (a) => (a.category_uid !== undefined ? { filters: { category_uid: { eq: a.category_uid } } } : {}),
      transform: (value, a) => {
        const items = ((value as { items?: unknown[] } | null)?.items ?? []) as { uid?: unknown }[];
        // A filter Magento cannot decode is ignored, not rejected: it answers with the default tree. Say so.
        return a.category_uid !== undefined && items[0]?.uid !== a.category_uid ? NO_MATCH : items;
      },
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_category",
      description: "Use this to read one category as the storefront shows it, by uid or URL path: description, meta tags, display mode, breadcrumbs and direct children.",
      input: oneInput,
      document: ONE,
      pick: "categories",
      variables: (a) => ({ filters: a.category_uid !== undefined ? { category_uid: { eq: a.category_uid } } : { url_path: { eq: a.url_path } } }),
      transform: (value, a) => {
        const first = ((value as { items?: unknown[] } | null)?.items ?? [])[0] as { uid?: unknown; url_path?: unknown } | undefined;
        // `categories` ignores a filter it cannot decode and answers with another category: trust only the one asked for.
        const asked = a.category_uid !== undefined ? first?.uid === a.category_uid : first?.url_path === a.url_path;
        return first !== undefined && asked ? first : NO_MATCH;
      },
      context: contextOf,
    }),
  ];
}
