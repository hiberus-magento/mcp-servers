# @hiberus-magento/magento-rest

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
