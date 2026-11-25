---
"@hiberus-magento/magento-rest": minor
---

`magentorest_create_sales_rule` and `magentorest_update_sales_rule` take `discount_step`, Magento's "Discount Qty Step". On a `buy_x_get_y` rule it is the X: buy X items and get `discount_amount` items free. On `by_percent` and `by_fixed` it is a quantity step, and `cart_fixed` ignores it.

On a `buy_x_get_y` rule, a write that changes `simple_action`, `discount_step`, `discount_amount` or `discount_qty` is now refused in these cases, because Magento gives such a rule no discount and reports no error:
- the X is below 1;
- the Y is 0 or greater than the X;
- `discount_qty` is at or below the X.

Before this change, a `buy_x_get_y` rule could be created that way.
