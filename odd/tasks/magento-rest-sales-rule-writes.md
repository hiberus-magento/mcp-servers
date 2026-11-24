# magento-rest: cart price rule writes and a write-hint audit

Objective: let Kora create, update (undo, deactivate) and generate coupons for cart price rules through typed write tools, and confirm every write tool's hints and description.
Branch: feat/magento-rest-sales-rule-writes (on top of feat/magento-rest-sales-rule-active-on, PR #24). Delivery: ask-on-risk. Runner: vitest (`pnpm --filter @hiberus-magento/magento-rest test`), plus the 8 repository gates.

## Specs

Requested by Kora, approved by the user ("si, adelante"):

- S1 `magentorest_create_sales_rule`: "Input: name, description?, is_active, website_ids, customer_group_ids, from_date?, to_date?, simple_action (by_percent | by_fixed | cart_fixed | buy_x_get_y), discount_amount, discount_qty?, apply_to_shipping?, stop_rules_processing?, coupon_type (no_coupon | specific_coupon | auto), coupon_code?, uses_per_coupon?, uses_per_customer?, sort_order?". "Conditions: start with none, or one simple subtotal/SKU condition if that is cheap. Free-form serialized conditions are out." "Output: the rule as read back after writing, plus provenance." "Annotations: readOnlyHint false, destructiveHint false, idempotentHint false (a create is not idempotent)."
- S2 `magentorest_update_sales_rule`: "Input: rule_id plus a partial set of the same members. Only the received members change." "Output: the rule read back after writing." "Annotations: idempotentHint true." "Kora uses this tool for undo, which restores the previous members, and for deactivation."
- S3 `magentorest_generate_coupons` (lower priority): "Input: rule_id, qty (capped, e.g. ≤ 100), length?, format?, prefix?" "Output: the generated codes." "Annotations: not idempotent."
- S4 Rules: "R-6: the write tools are listed only with MCP_WRITES_ENABLED=true." "R-8: structured errors (invalid_argument with argument, permission_missing with resource Magento_SalesRule::quote, not_found)." "No customer inputs at all. Customer group ids are allowed."
- S5 "get_sales_rule_by_id must return every member the create and update tools accept, so Kora can read before and after with the same shape."
- S6 "The ACL is Magento_SalesRule::quote. Please document it in the README table."
- S7 Audit: "accurate annotations (readOnlyHint, destructiveHint, idempotentHint); descriptions that say what the tool changes. Please keep both true for every write tool, and flag any tool whose hints are wrong today."

## Tasks

- [x] T1 (S7) audit of 34 write tools: 3 fixed (assign_product_to_category → update; add_order_comment → action; create_customer description names the welcome email). Route: inline; Magento side effects checked by a read-only researcher. RED 3 failing, GREEN 1205/1205.
- [x] T2 (S1, S2, S4-S6) create_sales_rule + update_sales_rule (diff-only PUT, conditions never sent), by_id adds coupon_code, README ACL + section. Route: inline; Magento PUT semantics researched first (high risk: item 1). RED 38 failing (tools missing), GREEN 1243/1243; 8 gates green; tools/list diff vs 0.4.1: +2 tools, only intended changes.
- [x] T3 (S3) generate_coupons: checks the rule takes generated codes, POST /coupons/generate, at most 100, returns { rule_id, codes, provenance }. Route: inline. RED 13 failing, GREEN 811/811 (tools); 8 gates green.

## Log

- L1 (2026-11-24) Kora's request (above), user: "si, adelante".
- L2 Audit evidence (Magento 2.4-develop source): CategoryLinkRepository::save upserts the position (a repeat is a no-op); OrderService::addComment always sets order.status from the comment; AccountManagement::createAccount without a password always sends registered_no_password, which only system/smtp/disable stops. hold/unhold stay `action` (conservative: a repeat fails rather than changing state).
- L3 T1 review review-b4707a0c67eb97f4 (risk, readability) over origin/main..93c9428 (includes the active_on commit): approved, acknowledged. Two advisory findings applied (nested describe blocks moved to top level); R2-null-filter-magic-value declined (the comment at the call site explains the 1).
- L4 Magento 2.4-develop SalesRule research (read-only, source): every route requires Magento_SalesRule::quote. PUT /V1/salesRules/:id loads the stored rule and merges only the non-null fields sent (ToModel::toModel array_filter + array_merge), so unsent fields, conditions included, are kept, and null cannot clear a field. RuleInterface has no coupon_code: the code is a primary coupon via POST /V1/coupons. coupon_type in REST is NO_COUPON | SPECIFIC_COUPON | AUTO. A create without website_ids/customer_group_ids saves an unbound rule. Model\Rule::afterSave deletes the primary coupon when coupon_type leaves SPECIFIC_COUPON. coupons/generate needs use_auto_generation or AUTO, returns string[], and has no cap.
- L5 T2 decisions: coupon_type takes Magento's REST values (NO_COUPON | SPECIFIC_COUPON | AUTO) rather than Kora's lowercase spelling, so read and write share one shape (S5). No member accepts null (Magento keeps a null field), so a date cannot be cleared. A code is required only when a rule becomes SPECIFIC_COUPON. by_percent is capped at 100. A failed coupon save deletes the rule this call created.
- L6 T3: the input is code_prefix, not Kora's `prefix`: `prefix` is a customer's name prefix on the personal-field denylist (customer-data.ts), and the no-customer-input test caught it. A host checking input names would refuse the tool over it.
