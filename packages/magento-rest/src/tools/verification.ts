// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single place that records which tools have been run against a real
// Magento instance. The repository's convention (docs/team-setup.md §6) is
// that a tool carries "Not verified against a live service" in BOTH the
// manifest (read by the human deciding to install) and its shipped
// description (read by the agent deciding to call), and that ABSENCE of the
// marker records no claim either way — it is not a verification badge. So the
// honest default is to mark every tool, and to take one off only here, in a
// reviewed change, after it has actually been exercised against a real
// instance.
//
// Verified so far: 86 of the 93 REST tools (the nine `magentorest_db_*` database tools are all still marked: none has been run against a real database), run on 2026-10-26 and 2026-10-27 against a local Magento
// Open Source 2.4.8-p5 (a development stack behind Varnish and TLS, multi-source
// inventory enabled, 121 products, 623 customers, 52 orders — all test data).
// Each was called through the built MCP server, returned a successful response
// with DATA, and its fields were checked against the allowlist; every write was
// then confirmed by READING the state back, and the entities it created were
// removed. Only a tool that returned data (or whose effect was read back) is
// listed: one that answered with an empty list proved the request is accepted
// but not that its projection fits a real record.
//
// `create_customer` and `delete_customer` were verified on 2026-10-27: the customer
// was created, read back, deleted and read back as gone. The test store had
// customised customer creation (it answered with an acknowledgement and created the
// customer later), and left a link that made the first delete fail with a 404. Both
// are properties of that store's customisation, which nothing here is written
// around: the tools target stock Magento, where creation is synchronous.
//
// Still marked, and why:
//   - `add_attribute_option` (an option cannot be removed with these tools) and
//     `delete_coupon` (there are no coupons, and none can be created here);
//   - `get_sales_rule_by_id`, `get_coupon_by_id`, `get_sales_rules`,
//     `search_coupons`, `get_tax_rules`: no records to read.
//
// Not offered at all: `search_url_rewrites` (a stock Magento answers 404 — the
// endpoint is not part of core).
//
// The run found, and this change fixed, five tools that could never have worked
// as the original wrote them (`get_order_statuses`: not a route;
// `create_cms_block` and `create_cms_page`: Magento refuses `store_id`;
// `update_product_media`: needs `media_type`; `add_shipment_tracking`: needs
// `order_id`), plus the behaviours recorded in `openspec/changes/
// 2026-10-26-magento-rest-package/design.md` D15.

/** Must match `UNVERIFIED_MARKER` in `scripts/gen-readme.mjs`. */
export const UNVERIFIED_MARKER = "Not verified against a live service";

/** What was and was not run; shared word for word by the manifest and every shipped description. */
export const UNVERIFIED_DETAIL =
  "this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.";

/** Tool names exercised against a real instance. Add one only after running it there. */
export const LIVE_VERIFIED_TOOLS: ReadonlySet<string> = new Set<string>([
  "magentorest_get_websites",
  "magentorest_get_store_groups",
  "magentorest_get_store_views",
  "magentorest_get_store_configs",
  "magentorest_get_currency_info",
  "magentorest_get_countries",
  "magentorest_search_products",
  "magentorest_get_product_by_sku",
  "magentorest_get_product_stock",
  "magentorest_get_source_items",
  "magentorest_advanced_product_search",
  "magentorest_get_product_media",
  "magentorest_get_product_media_entry",
  "magentorest_get_category_tree",
  "magentorest_get_category_by_id",
  "magentorest_get_products_in_category",
  "magentorest_list_categories",
  "magentorest_get_low_stock_products",
  "magentorest_get_inventory_sources",
  "magentorest_get_inventory_stocks",
  "magentorest_search_product_attributes",
  "magentorest_get_product_attribute",
  "magentorest_get_attribute_options",
  "magentorest_get_attribute_sets",
  "magentorest_get_attribute_set_attributes",
  "magentorest_search_cms_blocks",
  "magentorest_get_cms_block_by_id",
  "magentorest_search_cms_pages",
  "magentorest_get_cms_page_by_id",
  "magentorest_get_tax_rates",
  "magentorest_get_tax_classes",
  "magentorest_get_order_count",
  "magentorest_get_revenue",
  "magentorest_get_product_sales",
  "magentorest_get_revenue_by_country",
  "magentorest_get_customer_by_id",
  "magentorest_search_customers",
  "magentorest_get_customer_groups",
  "magentorest_get_customer_addresses",
  "magentorest_search_carts",
  "magentorest_get_cart_by_id",
  "magentorest_get_cart_items",
  "magentorest_get_abandoned_carts",
  "magentorest_search_orders",
  "magentorest_get_order_by_id",
  "magentorest_get_order_by_increment_id",
  "magentorest_get_order_items",
  "magentorest_get_order_comments",
  "magentorest_get_customer_ordered_products_by_email",
  "magentorest_search_invoices",
  "magentorest_get_invoice_by_id",
  "magentorest_search_shipments",
  "magentorest_get_shipment_by_id",
  "magentorest_search_creditmemos",
  "magentorest_get_creditmemo_by_id",
  "magentorest_create_category",
  "magentorest_update_category",
  "magentorest_move_category",
  "magentorest_delete_category",
  "magentorest_create_product",
  "magentorest_update_product",
  "magentorest_update_product_attribute",
  "magentorest_delete_product",
  "magentorest_assign_product_to_category",
  "magentorest_remove_product_from_category",
  "magentorest_update_product_stock",
  "magentorest_add_product_image",
  "magentorest_update_product_media",
  "magentorest_delete_product_media",
  "magentorest_create_cms_block",
  "magentorest_update_cms_block",
  "magentorest_delete_cms_block",
  "magentorest_create_cms_page",
  "magentorest_update_cms_page",
  "magentorest_delete_cms_page",
  "magentorest_create_customer",
  "magentorest_update_customer",
  "magentorest_delete_customer",
  "magentorest_add_order_comment",
  "magentorest_hold_order",
  "magentorest_unhold_order",
  "magentorest_cancel_order",
  "magentorest_create_invoice",
  "magentorest_create_shipment",
  "magentorest_add_shipment_tracking",
  "magentorest_create_creditmemo",
]);
