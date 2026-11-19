# Design: `magento-graphql`

Modelled on `magento-rest` (design D1-D16): same layering, same guarantees, rewritten for GraphQL.

```
src/client/   pure: no environment, no output, no exit (purity.test.ts)
  operation-guard.ts  reads a document's operations; refuses what the caller did not ask for
  errors.ts           HTTP failures and GraphQL `errors` become one classified error
  retry.ts rate-limiter.ts   copied from magento-rest (not imported)
  http.ts             the only code that touches the network
  index.ts            createMagentoGraphqlClient: query() and mutate()
src/credential-provider.ts   OPTIONAL customer token, never cached
src/tools/    the adapter layer; the only place process.env is read
src/mcp.ts src/cli.ts        thin adapters
```

**D1 — Two entry points on the client, and each refuses the other's operation.** `query()` accepts
a document only if `operation-guard` finds exactly one operation and it is a `query`;
`mutate()` only if it is a `mutation`. A subscription is never accepted. The write switch decides
whether a tool that calls `mutate()` is registered at all; the guard is what makes the generic
`query` tool unable to mutate even if it is handed `mutation { ... }` or a document with two
operations. *Alternative rejected:* trusting the tool's own annotation.

**D2 — The guard is a small tokenizer, not `graphql-js`.** `graphql` would add ~150 KB to a bundle
with a 2 MB budget for one question ("what kind of operation is this, how deep, how big"). The
tokenizer skips comments, strings and block strings, tracks `{}`/`()`/`[]` nesting, and reads the
operation keyword at depth 0. A document it cannot read to the end (unbalanced, unterminated string)
is refused, never passed on. Limits: 8,000 characters and selection depth 12, so an agent cannot
send a query that is expensive by construction (Magento also enforces its own depth/complexity).

**D3 — Fixed documents for curated tools; the query is the allowlist.** Output is whatever the
document selects, so there is no second allowlist to drift. `project()` is not used; instead a test
asserts no curated document selects a credential-shaped field name. Variables are always passed as
GraphQL variables, never interpolated into the document (no injection through a SKU or search term).

**D4 — Transport.** `POST` JSON to the endpoint, `redirect: "manual"`, https only (http for
loopback), no embedded credentials in the URL, no switch for TLS. Headers: `Store` (view code,
`MAGENTO_GRAPHQL_STORE`, overridable per call, validated against `^[a-z0-9_]{1,32}$`),
optional `Content-Currency`, optional `Authorization: Bearer <customer token>`. A query is retried
on 429/502/503/504 with full-jitter backoff; a mutation never is (a replayed `addProductsToCart`
doubles the quantity).

**D5 — Errors keep Magento's message and nothing else.** GraphQL answers HTTP 200 with an `errors`
array. With no `data`, that is a failure; with partial `data`, the data is returned together with
the messages. Messages are redacted and capped. `extensions`, `locations` and `path` are dropped,
and a non-JSON body is never surfaced. `category: graphql-authorization` and
`graphql-authentication` map to `unauthorized` with a remedy that says how to set the token.

**D6 — The customer token is optional and only that.** `resolveCredentialValue` raises
`MissingCredentialError` when there is none: that means *anonymous*. Any other error (a credential
file with loose permissions) propagates, so a misconfigured file is never silently downgraded to
anonymous. The customer tools say so when Magento refuses them anonymously. `auth token set` reads
the token from stdin only (no `--token`).

**D7 — Groups and the write switch** are as in `magento-rest` (D9, D16): `MAGENTO_GRAPHQL_GROUPS`,
read once, unknown name stops the server; `MAGENTO_GRAPHQL_ALLOW_WRITES` exactly `true`.
Groups: `products`, `categories`, `cms`, `store`, `customer`, `cart`, `query`.

**D8 — Every tool is "not verified" until it is run against a real instance** (same convention as
`magento-rest` D10): `verification.ts` is the one place that records it.

**D9 — Stock Magento only.** Documents use fields of the core `Magento_*GraphQl` modules. A store
with extensions may add fields; nothing here depends on them, and the generic tool is how to reach them.

**D10 — What the first run against a live Magento changed (2026-11-05, 2.4.8-p5, anonymous).**
14 tools returned real data. The run found four things the unit tests could not:
`customer { group }` does not exist on this schema (removed from the document); a CMS block that does
not exist comes back as a `null` entry next to an error message (the nulls are dropped, the message kept);
a URL has to be asked for with the store's URL suffix, so "no route" now says so (`/carbide-rods` found
nothing, the same path with `.html` is what the storefront serves); and an anonymous `customer` query was
answered with HTTP 403 where stock Magento answers 200 with an `errors` entry, so a 403 now carries a remedy
that names both a firewall in front of Magento and the customer token. Any selection of `aggregations` made
that store answer "Internal server error", so `include_aggregations` is documented as not seen working.
The customer tools, `get_cms_blocks` and the cart tools stay "not verified".

**D11 — Every operation of the schema, generated (2026-11-05).** The user asked for all of them. 206 operations
exist in the live schema (49 queries, 157 mutations); 17 were covered by the 25 hand-written tools, and the other 189 were
generated by `scripts/gen-graphql-tools.mjs` from an introspection result into `src/tools/generated/schema-tools.ts`,
which is committed so a reviewer reads the documents. Per operation: one fixed document with every argument a
variable of the schema's own type; a strict zod schema built from the schema's input types (lazy, so cyclic input types
work, and a thunk, so only the loaded groups pay for it); a selection set that is an allowlist (scalars and enums, nested
objects as deep as keeps the document under 6,500 characters, no field that needs a required argument, no field named
like a password, secret, CVV, API key or card number, short fixed selections for products, categories, carts and
customers). The generator stops when a schema operation has no group, so a new operation is placed on purpose.
Groups became twenty (D7 listed seven): `account`, `checkout`, `orders`, `returns`, `wishlist`, `compare`, `payments`,
`gift-and-rewards`, `gift-registry`, `company`, `purchase-orders`, `quotes` and `requisition-lists` were added. Seven of them
are Adobe Commerce only and say so in each description. **This reverses two earlier choices at the user's request:**
`place_order` and the account tools (`generate_customer_token`, `create_customer_v2`, `change_customer_password`,
`reset_password` ...) exist now, behind the same write switch, never retried. Their descriptions say that a password
passes through the conversation and that a returned token enters it. Deprecated operations are not generated (Magento
hides them from introspection); the two curated tools that use `categoryList` and `urlResolver` stay because they were
verified live. **What was checked:** every document, generated or not, was validated against the live schema without being
executed: sent with one extra invalid field, which makes the whole document invalid, so the server reports every real
error and runs nothing (a control with a wrong nested field was reported). Six generated reads that returned real data anonymously are marked verified; the other 183 are not.
Start-up CPU rose to about 105 ms with every group loaded, so the package declares a 150 ms budget (cold-start.ts method).

**D12 — No deprecated operation or field (2026-11-10).** The user asked for deprecated operations to stay out. Magento hides
deprecated *operations* from introspection by default, which the generator relied on, but a deprecated *field* inside a
selection is still accepted, so a document can be valid and still lean on something Magento will remove. The hand-written
documents did: `Cart.items` (now `itemsV2 { items }`), `CustomerAddress.id` (now `uid`), the configurable option `value_index`
(`uid` was already selected), `categoryList` (now `categories`), `urlResolver` (dropped: the generated `get_route` replaces it)
and `createEmptyCart` (dropped: the generated `create_guest_cart` replaces it). The store's schema had also moved on since
D11: 7 operations were new (`clearWishlist`, `customerGroup`, `customerSegments`, `deleteCustomerAddressV2`,
`updateCustomerAddressV2`, `exchangeExternalCustomerToken`, `appendPaymentServicesStorefrontLogs`), and `trackViewedProduct`,
`deleteCustomerAddress` and `updateCustomerAddress` were gone or deprecated, so the generator now yields 193 operations and the
package 216 tools (23 hand-written). Every document was walked type by type against a schema introspected WITH deprecated
fields: none selects a deprecated field. The same run showed that `categories` ignores a filter it cannot decode and answers with
another category, so `get_category` and `get_category_tree` trust an answer only when it is the one asked for. Tools removed
(`resolve_url`, `create_empty_cart`) were never published.

**D13 — The write path, run for real (2026-11-10).** With the write switch on, against the same test store, a guest cart went through
create, add, update, remove, clear, guest e-mail, shipping address, billing address, shipping method and the two estimates, reading the
cart back after each change; 12 more tools are marked verified (32 of 216). One generator rule changed because of it: `input` is
required in a tool's schema only when its input type has a required field (`create_guest_cart` has none, so `{}` is a real call).
`place_order` was deliberately not run. A guest cart is left behind in the store for each run (empty, not purged by these tools).
