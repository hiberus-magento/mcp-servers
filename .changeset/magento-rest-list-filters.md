---
"@hiberus-magento/magento-rest": minor
---

Every list tool that reads through Magento's searchCriteria (products, categories, customer groups, orders, invoices, shipments, credit memos, carts, CMS blocks and pages, product attributes and attribute sets, inventory sources, stocks and source items, sales rules, coupons, tax rates, rules and classes) now takes typed `filters` (`field`, `condition`, `value`; ANDed, at most 10) and a `sort`, on a closed list of each tool's columns that holds no customer-identifying column. A tool's own inputs are ANDed with them, also on the same column. `search_orders` now sorts only on its listed columns, and passing `sort` together with `sort_field` or `sort_direction` (there and in `advanced_product_search`) is refused as `invalid_argument` on `sort`. New `magentorest_list_orders` and `magentorest_list_carts` list orders and carts without any customer input.
