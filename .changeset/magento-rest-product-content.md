---
"@hiberus-magento/magento-rest": minor
---

- **Product content per store view.** `magentorest_get_product_content` reads name, description, short description, meta title, meta description and image labels as one store view shows them (`found: false` for an unknown SKU). `magentorest_update_product_content` changes any of them in one store view only: it refuses `all`, `admin` or no store view, reads first (an unknown SKU or image is `not_found`, no product is created), checks lengths, sends only what differs and returns the content read back. Requires Magento 2.4.7+. Side effect: Magento writes a store-view value for every image of the product, so those images stop inheriting later default changes in that store view.
- **Typed errors.** Every failure carries `structuredContent: { error: { code, ... } }` (`unauthorized`, `permission_missing` with the ACL resource, `rate_limited` with `retry_after_ms`, `timeout`, `unavailable`, `invalid_argument` / `not_found` with the argument, `upstream_error` with `http_status`) next to the prose.
