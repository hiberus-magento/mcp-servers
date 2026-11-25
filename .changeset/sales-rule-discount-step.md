---
"@hiberus-magento/magento-rest": minor
---

`magentorest_create_sales_rule` and `magentorest_update_sales_rule` take `discount_step`, Magento's "Discount Qty Step": the X of a `buy_x_get_y` rule ("buy X, get `discount_amount` free"), or the quantity step of the other actions.

A write that changes `simple_action`, `discount_step` or `discount_amount` on a `buy_x_get_y` rule is now refused when the X is below 1 or the Y is greater than the X, because Magento gives such a rule no discount and reports no error. Before this change, a `buy_x_get_y` rule could be created that way.
