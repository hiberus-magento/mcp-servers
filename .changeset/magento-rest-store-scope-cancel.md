---
"@hiberus-magento/magento-rest": patch
---

Catalog writes (create/update product, update product attribute, add/update product media, create/update category) now run in the `all` store scope by default, so they change the global values instead of only the default store view's; pass `store_code` to change one store view. CMS creates and updates always run in `all`, so the block or page is on all store views. Revenue, product-sales and revenue-by-country leave out canceled and closed orders when no status is given, and never add amounts in different currencies together (they return `by_currency` instead). A tool call the MCP client cancels aborts its in-flight request.
