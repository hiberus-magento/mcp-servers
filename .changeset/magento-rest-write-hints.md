---
"@hiberus-magento/magento-rest": patch
---

Write-tool hints and descriptions now match what Magento does:

- `magentorest_assign_product_to_category` is an update (destructive, idempotent): when the product is already in the category, Magento replaces its position.
- `magentorest_add_order_comment` is an action (destructive, not idempotent): Magento writes the order's own status from the comment, and each call adds an entry.
- `magentorest_create_customer` now says that Magento emails the new customer, which no input can stop.
