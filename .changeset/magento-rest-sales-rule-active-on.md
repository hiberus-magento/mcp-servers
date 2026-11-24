---
"@hiberus-magento/magento-rest": minor
---

`magentorest_get_sales_rules` takes `active_on` (`YYYY-MM-DD`), which keeps the cart price rules whose stored `from_date` is on or before that day and whose `to_date` is empty or on or after it. On Adobe Commerce with content staging, a scheduled update may not show in those stored dates, and the description says so.
