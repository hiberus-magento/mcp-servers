---
"@hiberus-magento/magento-rest": minor
---

New write tool `magentorest_generate_coupons`. It generates up to 100 codes for a cart price rule that takes generated codes (`AUTO`, or `SPECIFIC_COUPON` with auto-generation) and returns them. A rule that does not take generated codes is refused as `invalid_argument` on `rule_id`, and a missing rule is `not_found`.
