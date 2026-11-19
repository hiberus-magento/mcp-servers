// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Product reads over the storefront schema: what a shopper-facing site can see, which is not
// what the admin REST API sees (disabled and not-visible products are absent here).
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf, currentPage, pageSize, sku } from "./inputs.js";

const PRICE_RANGE = `
  price_range {
    minimum_price {
      regular_price { value currency }
      final_price { value currency }
      discount { amount_off percent_off }
    }
    maximum_price { final_price { value currency } }
  }`;

const SEARCH_PRODUCTS = `
query SearchProducts($search: String, $filter: ProductAttributeFilterInput, $sort: ProductAttributeSortInput, $pageSize: Int, $currentPage: Int, $aggregations: Boolean!) {
  products(search: $search, filter: $filter, sort: $sort, pageSize: $pageSize, currentPage: $currentPage) {
    total_count
    page_info { current_page page_size total_pages }
    items {
      __typename
      uid
      sku
      name
      url_key
      canonical_url
      stock_status
      ${PRICE_RANGE}
      small_image { url label }
    }
    aggregations @include(if: $aggregations) {
      attribute_code
      label
      count
      options { label value count }
    }
  }
}`;

const GET_PRODUCT = `
query GetProduct($filter: ProductAttributeFilterInput) {
  products(filter: $filter, pageSize: 1) {
    items {
      __typename
      uid
      sku
      name
      url_key
      canonical_url
      meta_title
      meta_description
      stock_status
      only_x_left_in_stock
      description { html }
      short_description { html }
      ${PRICE_RANGE}
      categories { uid name url_path }
      media_gallery { url label position disabled }
      ... on ConfigurableProduct {
        configurable_options { attribute_code label values { uid label } }
        variants {
          attributes { code label uid }
          product { sku name stock_status ${PRICE_RANGE} }
        }
      }
    }
  }
}`;

const searchInput = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Full-text search term."),
    sku: z.array(sku).min(1).max(50).optional().describe("Only these SKUs (exact match)."),
    category_uid: z.string().regex(/^[A-Za-z0-9+/=_-]{1,128}$/, "a uid: base64 text").optional().describe("Only products in this category (its uid, from magentographql_get_category_tree)."),
    price_from: z.number().min(0).optional().describe("Lowest price, inclusive."),
    price_to: z.number().min(0).optional().describe("Highest price, inclusive."),
    sort_by: z.enum(["relevance", "position", "price", "name"]).optional().describe("Sort field (default: Magento's own order)."),
    sort_direction: z.enum(["ASC", "DESC"]).optional().describe("Sort direction (default ASC); ignored without sort_by."),
    page_size: pageSize(),
    current_page: currentPage,
    include_aggregations: z.boolean().optional().describe("Also return the layered-navigation facets (attribute, label, counts). Larger output (default false). Not yet seen working against a live store."),
    ...context,
  })
  .strict()
  .refine((a) => a.search !== undefined || a.sku !== undefined || a.category_uid !== undefined || a.price_from !== undefined || a.price_to !== undefined, {
    message: "Give at least one of search, sku, category_uid, price_from or price_to — Magento refuses a product query with neither a search nor a filter.",
  });

const getInput = z
  .object({ sku: sku.optional(), url_key: z.string().min(1).max(255).optional().describe("The product's URL key, e.g. my-tent."), ...context })
  .strict()
  .refine((a) => (a.sku === undefined) !== (a.url_key === undefined), { message: "Give exactly one of sku and url_key." });

export function productTools({ readTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_search_products",
      description:
        "Use this to search the storefront catalog by text, SKU list, category uid or price range, with sorting and paging: SKU, name, URL key, stock status, price range and thumbnail. It sees only what a shopper sees — disabled or not-visible products are absent.",
      input: searchInput,
      document: SEARCH_PRODUCTS,
      pick: "products",
      variables: (a) => {
        const filter: Record<string, unknown> = {};
        if (a.sku !== undefined) filter["sku"] = a.sku.length === 1 ? { eq: a.sku[0] } : { in: a.sku };
        if (a.category_uid !== undefined) filter["category_uid"] = { eq: a.category_uid };
        if (a.price_from !== undefined || a.price_to !== undefined) {
          filter["price"] = { ...(a.price_from !== undefined ? { from: String(a.price_from) } : {}), ...(a.price_to !== undefined ? { to: String(a.price_to) } : {}) };
        }
        return {
          ...(a.search !== undefined ? { search: a.search } : {}),
          ...(Object.keys(filter).length > 0 ? { filter } : {}),
          ...(a.sort_by !== undefined ? { sort: { [a.sort_by]: a.sort_direction ?? "ASC" } } : {}),
          pageSize: a.page_size ?? 10,
          currentPage: a.current_page ?? 1,
          aggregations: a.include_aggregations ?? false,
        };
      },
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_product",
      description:
        "Use this to read one product as the storefront shows it, by SKU or URL key: descriptions, meta tags, stock status, price range, categories, gallery, and for a configurable product its options and variants.",
      input: getInput,
      document: GET_PRODUCT,
      pick: "products",
      variables: (a) => ({ filter: a.sku !== undefined ? { sku: { eq: a.sku } } : { url_key: { eq: a.url_key } } }),
      transform: (value) => {
        const items = (value as { items?: unknown[] } | null)?.items;
        return Array.isArray(items) && items.length > 0 ? items[0] : "No product matches this sku or url_key in the storefront (it may be disabled, not visible, or in another store view).";
      },
      context: contextOf,
    }),
  ];
}
