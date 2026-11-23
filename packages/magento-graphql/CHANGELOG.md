# @hiberus-magento/magento-graphql

## 0.2.0

### Minor Changes

- 0706670: Opt-in HTTP mode for callers that cannot launch a child process (a PHP middleware, a queue consumer). Set `<PREFIX>_HTTP_PORT` and `<PREFIX>_HTTP_TOKEN` (at least 32 characters, environment only) and the MCP server listens on `http://127.0.0.1:<port>/mcp` instead of stdio; unset, it speaks stdio exactly as before. Stateless: one `POST` per call with a JSON-RPC body and `Authorization: Bearer`, no `initialize` or session, JSON replies. Requests are refused with 401 (token), 403 (`Host`/`Origin` not allowed, DNS-rebinding protection), 404 (path), 405 (any method but `POST`, so a standard MCP client does not reconnect for a stream that does not exist) or 413 (body over 1 MiB). Each request writes one access-log line to stderr (method, status, tool name, duration; never arguments or the token), and `SIGTERM`/`SIGINT` give requests in flight 5 seconds and exit 0. `<PREFIX>_HTTP_HOST`, `<PREFIX>_HTTP_ALLOWED_HOSTS` and `<PREFIX>_HTTP_ALLOWED_ORIGINS` widen the defaults for containers. In `magento-graphql`, the tools the connected store does not offer stay out of `tools/list` for every request after the first call reads the schema. See `docs/http-mode.md`.

## 0.1.0

### Minor Changes

- f4dcba1: First release of `@hiberus-magento/magento-graphql`: an MCP server (`hiberus-magento-graphql-mcp`) and operator CLI (`hiberus-magento-graphql`) for the Magento 2 / Adobe Commerce GraphQL API. Query tools are registered by default; mutation tools only when `MAGENTO_GRAPHQL_ALLOW_WRITES=true`. A response whose requested fields are all null with errors (Magento's usual failure shape, e.g. a customer query without a token or a failed mutation) is reported as an error with its remedy, and every request attempt is bounded by a timeout. A tool call the MCP client cancels aborts its in-flight request. The 247 tools in 21 groups are generated from the latest Adobe Commerce schema with B2B and adapt to the connected store: its schema is read once, each curated or generated query is trimmed to the fields, arguments and types the store has, and a tool whose operation the store lacks answers that it is not offered and is then disabled (one `notifications/tools/list_changed` for all of them); an argument the caller gave that the store cannot take is named in the answer's `warnings`, and a schema read that fails in transit, on a 5xx/429/401/403/404 or with a proxy page is tried again a minute later. Without introspection the full query is sent and a query is retried without each field Magento reports missing, at most five times; the generic `magentographql_query` is never adapted.

### Patch Changes

- 890d774: Fix the operator CLI doing nothing when started through its npm/npx bin. npm and npx run a bin through a symlink in `node_modules/.bin`, and the entry-point check compared that symlink path with the real file, so commands such as `auth token set` and `auth status` printed nothing, stored nothing and exited 0. The check now compares real paths.
