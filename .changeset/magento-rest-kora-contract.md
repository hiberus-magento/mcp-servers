---
"@hiberus-magento/magento-rest": minor
---

Usable from an MCP host such as Kora:

- **Structured reads.** Every read tool declares an `outputSchema` and answers with `structuredContent` `{ result, provenance }`, mirrored exactly as JSON text. `provenance` gives the endpoint (method and path from `/rest` on, no host, query or token), `api_version`, `read_at` (when Magento answered) and the store view. The text of a read changes accordingly: it is the JSON of that object, no longer the bare record. A result over 100,000 bytes is refused with an error instead of being truncated.
- **Customer data off by default.** Results no longer carry customer personal data (names, email, phone, an order's `customer_*` identity, a cart's `customer`, a customer's address city and postcode). Set `MAGENTO_REST_CUSTOMER_DATA=true` to get the previous fields back. A `MAGENTO_REST_FIELDS_FILE` cannot add them while it is off. The database tools are not filtered.
- **`MCP_WRITES_ENABLED`.** The write switch an MCP host sets. When present it decides alone; `MAGENTO_REST_ALLOW_WRITES` still works when it is unset.
- **`server.json`.** The package ships the MCP registry manifest (schema 2025-12-11) with `mcpName` `io.github.hiberus-magento/magento-rest`, declaring `MAGENTO_REST_BASE_URL`, `MAGENTO_REST_TOKEN` (secret), `MAGENTO_REST_GROUPS` and `MCP_WRITES_ENABLED`. The release keeps its version in step.
