# magento-rest: typed conditions on the cart price rule writes

Objective: give create_sales_rule / update_sales_rule (and the read) a closed, typed condition input (Kora phase B). Branch `feat/sales-rule-conditions` from main b7245b1. Delivery: single PR (ask-on-risk). Runner: vitest (`corepack pnpm --filter @hiberus-magento/magento-rest test`), gates via scratchpad gates.sh.

## Specs

- S1 Cart conditions, Kora: "subtotal >= / <= an amount (base_subtotal); total qty in cart; shipping country."
- S2 Product conditions, Kora: "Product conditions (product found in cart / actions \"apply to\"): category ids (is one of / is not one of); SKU list (is one of)."
- S3 Free shipping, Kora: "Free shipping (simple_free_shipping: none / matching items only / whole cart)."
- S4 Input, Kora: "A typed, bounded condition input. No free-form condition_type class strings: a closed enum of the supported combinations above, all of the same aggregator (ALL true), no nesting beyond one level."
- S5 Read, Kora: "The read side (get_sales_rule_by_id) returns the same typed conditions, so Kora can show before/after and build an undo input."
- S6 Update, Kora: "Update replaces the whole condition set (idempotent). Clearing the conditions is expressible: an empty list, not null, since you told us nulls are refused."
- S7 Kora: "An outputSchema on create/update, and the same write-hint audit as 0.6.0."
- S8 (proposed to the user, accepted with "si, adelante"): a stored condition set outside the closed list reads as unsupported, and update refuses to replace it unless asked explicitly.

## Tasks

- [x] T1 S1-S8 inline: conditions module (schema, to Magento, from Magento), wired into create/update/read; tests; README; changeset. Commit: (this commit)

## Log

- L1 2026-11-24 Kora request (verbatim in the session): add conditions to create/update sales rule; priorities 1-3 and constraints as quoted in S1-S7. User: "si, adelante."
- L2 Magento 2.4-develop source checked: REST `condition`/`action_condition` are ConditionInterface trees (condition_type, conditions, aggregator_type, operator, attribute_name, value); ToModel replaces the tree when one is sent (setConditions([])->loadArray), an empty `conditions` clears it. Address attributes base_subtotal, total_qty (numeric ops >=, <=), country_id (select ops ==, != only, no "is one of"). Product conditions go under Product\Found (value 1 FOUND / 0 NOT FOUND); category_ids and sku take () / !(), values comma separated. simple_free_shipping travels raw ("0", "1" item, "2" address/whole shipment), no mapping.
- L3 T1 RED: 24 of 40 new tests failed before the module existed (the 16 others are input refusals the strict schemas already made). GREEN: 862 tool tests; all 8 gates pass (lint, typecheck, test, build, verify:package, gen-readme --check, licenses, synthetic identifiers). tools/list: create keeps readOnly false / destructive false / idempotent false, update keeps destructive true / idempotent true; the output schema carries conditions.
- L4 Deviation to report to Kora: shipping country is one country per condition (Magento's select operators are only == and !=), so "one of several countries" is not expressible under ALL. cart_has_no_product_in_categories uses Found NOT FOUND (no item in the categories) rather than "an item outside the categories", which is the reading a marketer means.
