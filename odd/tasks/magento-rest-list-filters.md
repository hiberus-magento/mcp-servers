# magento-rest: typed filters and sort on searchCriteria list tools

Objective: let a host narrow and order every searchCriteria list tool through typed `filters` and `sort`, without any customer-identifying column, and add order and cart lists with no customer inputs.
Branch: docs/magento-rest-acl (with the ACL table and redirect hint). Delivery: ask-on-risk; released as a minor. Runner: vitest (`pnpm --filter @hiberus-magento/magento-rest test`), plus the 8 repository gates.

## Specs

- S1: "Add `filters: [{ field, condition, value }]` to each searchCriteria list tool": `field` is an enum per tool, built from that tool's safe columns, using Magento's column names; `condition` is the client's condition list; `value` is a string, number or boolean, or an array for `in` and `nin`; filters are ANDed, at most 10.
- S2: "Add `sort: { field (same enum), direction ASC|DESC }`."
- S3: "Input names stay `filters` and `sort`: none of path, url, sql, graphql, endpoint or method."
- S4: "The existing bespoke inputs stay, so nothing breaks. A generic filter and a bespoke input on the same column are both sent (AND)." Kora: "Run an AND of a generic filter with a bespoke input on the same column through the same test, so the two cannot contradict each other silently."
- S5: "search_orders' free-text sort_field becomes constrained to the same enum."
- S6: "get_sales_rules gets `active_on` only after I verify from_date and to_date filtering on Adobe Commerce, where staging owns those dates."
- S7: "I'd add order and cart list tools without customer inputs, e.g. magentorest_list_orders and magentorest_list_carts, and keep the old ones for standalone use."
- S8: Kora: "keeping customer-identifying columns out of every enum is entirely the package's guarantee. Please pin it with a test that walks every tool's field enum against your customer-field denylist. The same applies to `sort`".

Tools in scope (22 + 2 new): search_products, advanced_product_search, get_products_in_category, list_categories, get_customer_groups, search_orders, search_invoices, search_shipments, search_creditmemos, search_carts, get_abandoned_carts, search_cms_blocks, search_cms_pages, search_product_attributes, get_attribute_sets, get_inventory_sources, get_inventory_stocks, get_source_items, get_sales_rules, search_coupons, get_tax_rates, get_tax_rules, get_tax_classes; new list_orders, list_carts.

## Tasks

- [x] T1 (S1-S3, S8) shared `tools/list-filters.ts` + tests; denylist test over every tool. Route: inline. RED observed (module missing), GREEN 43/43.
- [x] T2 (S1-S5, S7) wire the field sets into the list tools, constrain search_orders sort_field, add list_orders / list_carts, AND test, README + changeset. Route: inline. 8 gates green.
- [x] T3 (S6) sales-rule `active_on` (branch feat/magento-rest-sales-rule-active-on): tool-side `from_date <= D AND (to_date null OR to_date >= D)`, described as the stored row dates with the content-staging caveat. Route: inline. RED observed (unknown key `active_on`), GREEN 60/60. from_date/to_date still left out of the generic field list.

## Log

- L1 (2026-11-23) user: "si, adelante" to the plan above (proposal relayed to Kora; Kora accepted it with the two test conditions in S4 and S8).
- L2 Field names verified against Magento 2.4-develop di.xml: customer groups map id, code, tax_class_name; tax rates use tax_calculation_rate_id, tax_country_id, tax_region_id, code, rate, zip_*; tax rules map id, code, tax_rate_ids, customer_tax_class_ids, product_tax_class_ids.
- L3 T1+T2 committed together (one behavior: the helper has no user without the wiring). Wire test runs a filter and sort through all 25 tools; same-column AND test on 7 tools; denylist walk over every tool's field/sort_field enums.
- L4 Native review review-7da9d6077506ad83 (risk, readability, reliability) approved a53ac5d with suggestions only; acknowledged. Applied: shared assertOneSort, customerFilters rename, product sort_direction conflict test, free-text field exemption pinned. Declined: R2-sales-doc-description (the filters schema documents the input; rewriting 21 descriptions would only grow the manifest diff).
- L5 (2026-11-24) Kora's owner's probe of get_sales_rules on a client's Adobe Commerce Cloud staging (0.4.1): the first 5 rules by id all had from_date filled and to_date empty, and 200 rules in total. Not shown: how a staged (scheduled) update is represented; the edition could not be confirmed through the API. Kora: "ship active_on as a tool-side filter, from_date <= D and (to_date is null or to_date >= D), documented as 'the dates the rule row stores'." Accepted, with the caveat put in the input description and the README.
