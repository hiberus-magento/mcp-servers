# @hiberus-magento/magento-rest

## 0.4.0

### Minor Changes

- a53ac5d: Every list tool that reads through Magento's searchCriteria (products, categories, customer groups, orders, invoices, shipments, credit memos, carts, CMS blocks and pages, product attributes and attribute sets, inventory sources, stocks and source items, sales rules, coupons, tax rates, rules and classes) now takes typed `filters` (`field`, `condition`, `value`; ANDed, at most 10) and a `sort`, on a closed list of each tool's columns that holds no customer-identifying column. A tool's own inputs are ANDed with them, also on the same column. `search_orders` now sorts only on its listed columns, and passing `sort` together with `sort_field` or `sort_direction` (there and in `advanced_product_search`) is refused as `invalid_argument` on `sort`. New `magentorest_list_orders` and `magentorest_list_carts` list orders and carts without any customer input.

### Patch Changes

- 28a17a0: README: the Magento ACL resources each tool group needs, for reads and for writes, checked against Magento 2.4.7/2.4.8 and MSI, so an operator can tick exactly what an integration needs.
- 18e5dab: A redirect from Magento (a store with "Add Store Code to Urls" answers `/rest/...` with a 301 to `/<store code>/rest/...`) is still not followed, but it is now reported as `invalid_argument` on `MAGENTO_REST_BASE_URL`, and the message names the base URL to use instead when the redirect target shows it. The onboarding guide also covers a TLS-inspecting corporate proxy (`--use-system-ca`).

## 0.3.0

### Minor Changes

- 1979110: - **Product content per store view.** `magentorest_get_product_content` reads name, description, short description, meta title, meta description and image labels as one store view shows them (`found: false` for an unknown SKU). `magentorest_update_product_content` changes any of them in one store view only: it refuses `all`, `admin` or no store view, reads first (an unknown SKU or image is `not_found`, no product is created), checks lengths, sends only what differs and returns the content read back. Requires Magento 2.4.7+. Side effect: Magento writes a store-view value for every image of the product, so those images stop inheriting later default changes in that store view.
  - **Typed errors.** Every failure carries `structuredContent: { error: { code, ... } }` (`unauthorized`, `permission_missing` with the ACL resource, `rate_limited` with `retry_after_ms`, `timeout`, `unavailable`, `invalid_argument` / `not_found` with the argument, `upstream_error` with `http_status`) next to the prose.

## 0.2.1

### Patch Changes

- e86922b: Adds a `magento-rest` bin that starts the MCP server, so `npx @hiberus-magento/magento-rest` (and an MCP host or the MCP registry's npx launch, which run the bin named after the unscoped package) finds it. The `hiberus-magento-rest` CLI and `hiberus-magento-rest-mcp` bins are unchanged.

## 0.2.0

### Minor Changes

- 0706670: Opt-in HTTP mode for callers that cannot launch a child process (a PHP middleware, a queue consumer). Set `<PREFIX>_HTTP_PORT` and `<PREFIX>_HTTP_TOKEN` (at least 32 characters, environment only) and the MCP server listens on `http://127.0.0.1:<port>/mcp` instead of stdio; unset, it speaks stdio exactly as before. Stateless: one `POST` per call with a JSON-RPC body and `Authorization: Bearer`, no `initialize` or session, JSON replies. Requests are refused with 401 (token), 403 (`Host`/`Origin` not allowed, DNS-rebinding protection), 404 (path), 405 (any method but `POST`, so a standard MCP client does not reconnect for a stream that does not exist) or 413 (body over 1 MiB). Each request writes one access-log line to stderr (method, status, tool name, duration; never arguments or the token), and `SIGTERM`/`SIGINT` give requests in flight 5 seconds and exit 0. `<PREFIX>_HTTP_HOST`, `<PREFIX>_HTTP_ALLOWED_HOSTS` and `<PREFIX>_HTTP_ALLOWED_ORIGINS` widen the defaults for containers. In `magento-graphql`, the tools the connected store does not offer stay out of `tools/list` for every request after the first call reads the schema. See `docs/http-mode.md`.
- f6a387c: Usable from an MCP host such as Kora:

  - **Structured reads.** Every read tool declares an `outputSchema` and answers with `structuredContent` `{ result, provenance }`, mirrored exactly as JSON text. `provenance` gives the endpoint (method and path from `/rest` on, no host, query or token), `api_version`, `read_at` (when Magento answered) and the store view. The text of a read changes accordingly: it is the JSON of that object, no longer the bare record. A result over 100,000 bytes is refused with an error instead of being truncated.
  - **Customer data off by default.** Results no longer carry customer personal data (names, email, phone, an order's `customer_*` identity, a cart's `customer`, a customer's address city and postcode). Set `MAGENTO_REST_CUSTOMER_DATA=true` to get the previous fields back. A `MAGENTO_REST_FIELDS_FILE` cannot add them while it is off. The database tools are not filtered.
  - **`MCP_WRITES_ENABLED`.** The write switch an MCP host sets. When present it decides alone; `MAGENTO_REST_ALLOW_WRITES` still works when it is unset.
  - **`server.json`.** The package ships the MCP registry manifest (schema 2025-12-11) with `mcpName` `io.github.hiberus-magento/magento-rest`, declaring `MAGENTO_REST_BASE_URL`, `MAGENTO_REST_TOKEN` (secret), `MAGENTO_REST_GROUPS` and `MCP_WRITES_ENABLED`. The release keeps its version in step.

## 0.1.0

### Minor Changes

- 56b9719: First release of `@hiberus-magento/magento-rest`: an MCP server (`hiberus-magento-rest-mcp`) and operator CLI (`hiberus-magento-rest`) for the Magento 2 / Adobe Commerce REST API. Read tools are registered by default; write tools only when `MAGENTO_REST_ALLOW_WRITES=true`. Every result is projected through a field allowlist, every list is bounded, and TLS verification cannot be disabled.

### Patch Changes

- 890d774: Fix the operator CLI doing nothing when started through its npm/npx bin. npm and npx run a bin through a symlink in `node_modules/.bin`, and the entry-point check compared that symlink path with the real file, so commands such as `auth token set` and `auth status` printed nothing, stored nothing and exited 0. The check now compares real paths.
- b5988c5: Harden the database tools and the REST transport before the first release. The SQL guard refuses `??` identifier placeholders, matches credential tables under a Magento table prefix (and adds the 2FA, session and ACL tables), and refuses queries that reference credential-named columns; result redaction also uses the original column name, so an alias no longer reveals a credential. Each REST attempt is aborted after a timeout instead of hanging when Magento never answers.
- 1e8c011: Catalog writes (create/update product, update product attribute, add/update product media, create/update category) now run in the `all` store scope by default, so they change the global values instead of only the default store view's; pass `store_code` to change one store view. `create_product` takes `website_ids`; without it the product goes to the default website only (the `store_code` store view's website, or the only website; with several websites it asks for `website_ids`). CMS creates and updates always run in `all`, so a new block or page is on all store views (a page update keeps its assignment; a block update resets it, as Magento does on every REST block update). Revenue, product-sales and revenue-by-country leave out canceled and closed orders when no status is given, and never add amounts in different currencies together (they return `by_currency` instead). A REST tool call the MCP client cancels aborts its in-flight request (the database tools still run until their statement time limit).
