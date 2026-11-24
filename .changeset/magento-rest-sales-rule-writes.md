---
"@hiberus-magento/magento-rest": minor
---

New write tools for cart price rules. They are listed only when writes are enabled, and need `Magento_SalesRule::quote`.

- `magentorest_create_sales_rule` creates a rule without conditions. With `SPECIFIC_COUPON` it also saves the rule's code.
- `magentorest_update_sales_rule` sends only the members that differ from the stored rule and leaves its conditions alone.

Both answer with the rule read back. `magentorest_get_sales_rule_by_id` now also returns `coupon_code`, the code of a `SPECIFIC_COUPON` rule's primary coupon, so a host can read the same members before and after a write.
