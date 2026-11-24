---
"@hiberus-magento/magento-rest": minor
---

Cart price rules take typed conditions. `magentorest_create_sales_rule` and `magentorest_update_sales_rule` accept `conditions` (subtotal, item count, shipping country, products in the cart), `item_conditions` (category or SKU of the discounted items) and `free_shipping`, from a closed list of kinds. `magentorest_get_sales_rule_by_id` returns them in the same shape. An update replaces a whole set, `[]` clears it, and a set built in the admin outside the list is replaced only with `replace_unsupported_conditions`.
