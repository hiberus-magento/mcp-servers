// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single place that records which tools have been run against a real Magento instance. The
// repository's convention (docs/team-setup.md §6) is that a tool carries "Not verified against a
// live service" in BOTH the manifest and its shipped description, that ABSENCE of the marker
// records no claim either way, and that the honest default is to mark every tool and take one
// off only here, in a reviewed change, after it has actually been exercised against a real
// instance and its fields checked against the real schema.
//
// 2026-11-10: the documents were re-checked against the store's current schema (it had gained 7 operations and
// deprecated others); every selected field is now non-deprecated, and `get_category` / `get_category_tree` / `get_product` / `get_route`
// were run again after moving to `categories`, `route`, `itemsV2` and `uid`.
//
// Verified so far: 32 of the 216 tools, run on 2026-11-05 against a local Magento Open Source 2.4.8-p5
// (a development stack behind Varnish and TLS, with test data), anonymously and through the built MCP
// server. Each returned data from the real schema, not only a well-formed error; the corrections the run
// forced are in design.md D10. Only a tool that returned data is listed.
//
// Still marked, and why:
//   - `get_customer`, `get_customer_orders`, `get_customer_cart`: they need a customer token, and none was
//     used. Anonymously the test store answered HTTP 403 (Magento itself answers 200 with an error entry).
//   - `get_cms_blocks`: no block identifier that exists was found, so only the "does not exist" answer was seen.
//   - the other 175 tools generated from the schema (design D11) were only checked to be VALID against the live schema:
//     each document was sent with an extra invalid field, so nothing ran and no other error came back. Three more
//     answered with an empty list or null (`get_pickup_locations`, `get_product_review_ratings_metadata`,
//     `get_compare_list`), which proves the request is accepted but not that the selection fits a real record.
//   - `apply_coupon`: only Magento's "coupon is not valid" answer was seen (the store has no coupon), which proves the
//     request is accepted. `place_order`, the payment, account, wish list, compare, returns and B2B mutations were not run.
//   - `search_products` WITH `include_aggregations`: the same store answered "Internal server error" for any
//     selection of `aggregations`, even a one-field one sent through `magentographql_query`, so the facets
//     were never seen. Searching without them returned data.

/** Must match `UNVERIFIED_MARKER` in `scripts/gen-readme.mjs`. */
export const UNVERIFIED_MARKER = "Not verified against a live service";

/** What was and was not run; shared word for word by the manifest and every shipped description. */
export const UNVERIFIED_DETAIL =
  "this tool has not been run against a real Magento instance; its query document and response handling are covered by unit tests against a test double and by the conformance suite.";

/** Tool names exercised against a real instance. Add one only after running it there. */
export const LIVE_VERIFIED_TOOLS: ReadonlySet<string> = new Set<string>([
  "magentographql_get_store_config",
  "magentographql_get_available_stores",
  "magentographql_get_countries",
  "magentographql_get_country",
  "magentographql_get_currency",
  "magentographql_get_category_tree",
  "magentographql_get_category",
  "magentographql_search_products",
  "magentographql_get_product",
  "magentographql_get_cms_page",
  "magentographql_query",
  "magentographql_list_operations",
  "magentographql_describe_type",
  // Generated from the schema (design D11), each returned real data anonymously on 2026-11-05.
  "magentographql_get_checkout_agreements",
  "magentographql_get_route",
  "magentographql_get_attributes_list",
  "magentographql_get_recaptcha_v3_config",
  "magentographql_get_gift_registry_types",
  "magentographql_is_email_available",
  "magentographql_get_customer_group",
  // Cart and checkout, run on 2026-11-10 against the same store with the write switch on: a guest cart was created, filled,
  // changed, given a synthetic address, e-mail and shipping method, estimated, emptied, and read back after each change.
  "magentographql_get_cart",
  "magentographql_create_guest_cart",
  "magentographql_add_products_to_cart",
  "magentographql_update_cart_items",
  "magentographql_remove_cart_item",
  "magentographql_clear_cart",
  "magentographql_set_guest_email_on_cart",
  "magentographql_set_shipping_addresses_on_cart",
  "magentographql_set_billing_address_on_cart",
  "magentographql_set_shipping_methods_on_cart",
  "magentographql_estimate_shipping_methods",
  "magentographql_estimate_totals",
]);
