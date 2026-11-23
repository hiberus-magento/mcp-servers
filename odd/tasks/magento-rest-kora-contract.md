# magento-rest: meet the Kora MCP server contract (first version, 0.2.0)

Objective: make `@hiberus-magento/magento-rest` installable and usable by Kora's MCP host (contract: `SmartCommerce/kora/docs/guides/mcp-server-contract-for-kora.md`, rules R-1..R-25), first version scoped to the install blockers, structured output, provenance and no customer data by default.
Branch: `feat/magento-rest-kora-contract` (from origin/main d403739). Delivery: one PR, commits per work unit; release as 0.2.0 (minor) is the owner's decision. Runner: vitest (`pnpm --filter @hiberus-magento/magento-rest test`, `pnpm --filter @hiberus-magento/mcp-core test`).

## Specs

- S1 — R-19: the package ships a `server.json` in its root and tarball (`files`), `$schema` `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, one `packages[]` entry with `registryType` "npm", `identifier` "@hiberus-magento/magento-rest", `version` equal to package.json's, `transport.type` "stdio"; `package.json` `mcpName` equal to server.json `name` (`io.github.hiberus-magento/<something>`). No runtimeArguments/packageArguments, no format "filepath", no value/variables. Declared: "MAGENTO_REST_BASE_URL (required), MAGENTO_REST_TOKEN (required, secret), MAGENTO_REST_GROUPS (optional), MCP_WRITES_ENABLED". No database variables, no MAGENTO_REST_ALLOW_WRITES, not the customer-data flag (S5). The release version sync keeps server.json's versions in step.
- S2 — R-6: "the write switch must be MCP_WRITES_ENABLED (fixed name), declared in server.json with format "boolean", default "false", choices ["true","false"]. When it is not "true", write tools must not appear in tools/list and calls to them must fail." Agreed: "keep MAGENTO_REST_ALLOW_WRITES as an undeclared alias, MCP_WRITES_ENABLED wins when set."
- S3 — R-2: every read tool declares an `outputSchema` (JSON Schema of an object) and each successful result returns `structuredContent` valid against it, plus the text mirror. Kora: "what matters to Kora is that outputSchema is present in tools/list and structuredContent matches it."
- S4 — R-3: each read `structuredContent` carries `provenance` with `endpoint` (no base URL, no data query parameters, no token) and `read_at` (ISO 8601 UTC, when the platform answered); `api_version`, `store_view`, `website` when known.
- S5 — R-7: by default no customer personal data in outputs: "correo, nombre y apellidos, teléfono, direcciones, código postal, IP, fecha de nacimiento, identificador fiscal, género ni `customer_*`". Kora: "order and cart reads returning customer_email, firstname, lastname, customer_id or addresses would put personal data into the model context [...] they must project those fields out by default; an env flag Kora never sets can re-enable them for other consumers, and that flag must not be declared in the Kora server.json."

Out of scope (later version, agreed with Kora): R-8 typed errors, R-10 credential-file fallback, R-13 timeout budget, R-14 startup check, R-18 found:false, the 50-character tool name, R-20..R-25 product content tools.

## Tasks

- T1 [S3] mcp-core: optional outputSchema + structuredContent in the tool layer; magento-rest mcp.ts passes them to the SDK; check the Ajv stub with an output schema — inline — done (RED 1 → GREEN 16; SDK validates output with zod, not Ajv) — f80e35e
- T2 [S3,S4] magento-rest read tools: outputSchema per tool and structuredContent with provenance — inline — done (RED 2 transport + 3 factory → GREEN; rest 1049 + conformance 29 incl. end-to-end call on the built bundle) — f80e35e
- T3 [S5] customer fields out of default projections, re-enable flag — inline — done (RED 5 → GREEN; review follow-up tests for search, abandoned carts, by-email; MAGENTO_REST_CUSTOMER_DATA) — 044b2ec, fe64a8f
- T4 [S2] MCP_WRITES_ENABLED with the alias — inline — done (RED 6 → GREEN; end-to-end on the bundle) — 09ced1d
- T5 [S1] server.json, mcpName, files, version sync, docs, changeset — inline — done (RED mcpName/files and sync → GREEN; vendored schema, ajv validation; npm pack shows server.json)

## Log

- L1 (2026-11-23, kora-ba, relayed peer session on the owner's behalf): "Kora needs @hiberus-magento/magento-rest to meet Kora's MCP server contract before Kora can install it; 0.1.0 is refused today." Three install blockers: R-19 server.json, R-19 mcpName, R-6 MCP_WRITES_ENABLED. Later: "the three install blockers [...] plus the R-5 provenance block on read tools are what Kora needs first" (provenance is R-3). Then: "please include R-7 (no customer fields in outputs by default)."
- L2 (2026-11-23, user): "si, adelante" — approves the first version: S1-S5, as 0.2.0.
- L3 (2026-11-23): gap map (explorer): mcp-core `defineTool` returns text only (define-tool.ts:110, spot-checked); annotations already per effect (R-5 met); write tools filtered before registration (index.ts:129); PII in default allowlists in tools/shapes.ts (customer, order, cart, address); bundle stubs Ajv (mcp.ts:42-54).
- L4 (2026-11-23): reviews — f80e35e approved (lineage review-b2103ba9be0941e4); findings fixed in d8de825 (exact mirror, no-answer error, distinct endpoints, no `all` store view). d8de825+044b2ec approved (review-36ebae47ecd88045); findings fixed in fe64a8f (customer tools tested off, wording scoped to REST). Accepted, documented: a structured result over 100 KB is refused (was truncated text); name-based PII filter applies at any depth.
