# @hiberus-magento/magento-rest

## 0.1.0

### Minor Changes

- 56b9719: First release of `@hiberus-magento/magento-rest`: an MCP server (`hiberus-magento-rest-mcp`) and operator CLI (`hiberus-magento-rest`) for the Magento 2 / Adobe Commerce REST API. Read tools are registered by default; write tools only when `MAGENTO_REST_ALLOW_WRITES=true`. Every result is projected through a field allowlist, every list is bounded, and TLS verification cannot be disabled.

### Patch Changes

- 890d774: Fix the operator CLI doing nothing when started through its npm/npx bin. npm and npx run a bin through a symlink in `node_modules/.bin`, and the entry-point check compared that symlink path with the real file, so commands such as `auth token set` and `auth status` printed nothing, stored nothing and exited 0. The check now compares real paths.
- b5988c5: Harden the database tools and the REST transport before the first release. The SQL guard refuses `??` identifier placeholders, matches credential tables under a Magento table prefix (and adds the 2FA, session and ACL tables), and refuses queries that reference credential-named columns; result redaction also uses the original column name, so an alias no longer reveals a credential. Each REST attempt is aborted after a timeout instead of hanging when Magento never answers.
- 1e8c011: Catalog writes (create/update product, update product attribute, add/update product media, create/update category) now run in the `all` store scope by default, so they change the global values instead of only the default store view's; pass `store_code` to change one store view. `create_product` takes `website_ids`; without it the product goes to the default website only (the `store_code` store view's website, or the only website; with several websites it asks for `website_ids`). CMS creates and updates always run in `all`, so a new block or page is on all store views (a page update keeps its assignment; a block update resets it, as Magento does on every REST block update). Revenue, product-sales and revenue-by-country leave out canceled and closed orders when no status is given, and never add amounts in different currencies together (they return `by_currency` instead). A REST tool call the MCP client cancels aborts its in-flight request (the database tools still run until their statement time limit).
