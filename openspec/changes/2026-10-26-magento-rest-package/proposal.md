# Proposal: `magento-rest` — the Magento 2 REST API as an MCP server

## Why

An internal MCP server for the Magento 2 REST API already exists
(`magento2-mcp-server`, 109 tools: 101 over REST, 8 over MySQL). It is useful and
it is not safe to publish from a repository whose whole premise is that the unsafe
thing must be impossible to express. An audit of it found:

- caller input interpolated **raw into REST paths** (`/products/${sku}`), so a SKU
  of `a/../../customers` re-addressed the request to a different endpoint;
- `sort_field` / `sort_direction` spliced **unencoded into the query string**, so a
  value containing `&` appended extra criteria;
- results returned **whole** — an order's payment and address blocks, a customer's
  full record — rather than projected from an allowlist;
- error messages that **echoed Magento's response body**, whose `parameters` object
  carries the offending values (an email, an order id);
- **no bound** on `page_size`, and a `fetchAllPages` that looped until Magento ran
  out of records;
- **TLS verification disabled by default** through a template that set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, a process-wide switch;
- 31 **write tools, including refunds and deletes, always on**, with no switch;
- a **prefix-only SQL guard** (`startsWith("SELECT")`) on a free-form `db_query`.

## What

A new published package, `@hiberus-magento/magento-rest`, built on `mcp-core` like
`aco`, with two binaries: `hiberus-magento-rest-mcp` (server) and
`hiberus-magento-rest` (operator CLI: `auth token set`, `auth status`).

In scope: the REST tools of the original — 97 of them (its README says 101; 97 is
what the modules define), of which 93 are ported and 4 are deliberately not (D13, D15) —
in modules (products, store, then
categories, customers, orders, analytics, invoices, shipments, credit memos,
stock, carts, CMS, attributes, media, promotions, tax).

Out of scope, deliberately: the eight `db_*` MySQL tools (direct SQL needs its own
design — see design.md D8), `chat-proxy.js`, `mcp-client.js` and their Express /
OpenAI / Anthropic dependencies.

## Rollout and rollback

Additive: a new package, one `servers.json` entry, new docs, and new constants in
`mcp-testing`'s synthetic identifiers. No existing package changes behaviour.
Rollback is removing `packages/magento-rest`, its `servers.json` entry and its
docs, then `node scripts/gen-readme.mjs`; nothing else depends on it. Nothing is
published until a changeset is released.

## Risks

- **Allowlist projection is lossy by design.** An agent that used to receive a
  whole order now receives the fields in `shapes.ts`. Mitigation: widening a shape
  is a reviewed one-line change; the cost of a missing field is a visible gap, the
  cost of an extra one is a leak.
- **Nothing has run against a live Magento.** Every tool is marked
  "Not verified against a live service" in the manifest and in its shipped
  description until it is added to `LIVE_VERIFIED_TOOLS` after a real run.
