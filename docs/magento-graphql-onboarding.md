# Magento GraphQL onboarding

The day-one bootstrap for `@hiberus-magento/magento-graphql` — the
`hiberus-magento-graphql` CLI and the `hiberus-magento-graphql-mcp` server. It talks to the
GraphQL endpoint of a Magento 2 / Adobe Commerce instance, the same one a headless storefront
uses. Unlike [`magento-rest`](magento-rest-onboarding.md) it needs **no token to start**: the
storefront schema is public. There is one URL, an optional store view, an optional customer
token, and one decision about whether the agent may change carts.

## 1. The endpoint

`MAGENTO_GRAPHQL_BASE_URL` is the GraphQL endpoint itself, usually `https://<host>/graphql`.
It must be `https`; plain `http` is accepted only for `localhost`. A URL that embeds a user or
password is refused. A redirect is never followed: if your host redirects (`http` to `https`,
`localhost` to a real name, `www` to the bare domain), put the final URL in the variable.

The server starts and lists its tools without it; the first tool call is what fails, naming the variable.

## 2. Pick the store view

Without `MAGENTO_GRAPHQL_STORE` Magento answers for the default store view. Set it to a store
view code (see `magentographql_get_available_stores` for the codes) to read another view, or
pass `store` on a single call. `currency` on a call sets the `Content-Currency` header and must
be a currency that view allows.

## 3. Read-only by default, and what "write mode" means

With `MAGENTO_GRAPHQL_ALLOW_WRITES` unset, or anything but the exact text `true`, every mutation tool is
**not registered**: about 160 tools, from the cart ones to checkout, account, wish lists, returns and the B2B
operations, do not appear in the tool list at all. Turning it on registers them, including `place_order`, which
places a real order from the cart, and the account tools that take a password. The generic `magentographql_query`
tool refuses mutations in both modes.

A mutation is sent once and never retried: after an ambiguous failure (a timeout), read the cart
with `magentographql_get_cart` before trying again, or `add_products_to_cart` may add twice.

### Loading only the tools a project needs (`MAGENTO_GRAPHQL_GROUPS`)

Twenty groups: `products`, `categories`, `cms`, `store`, `customer`, `account`, `cart`, `checkout`, `orders`, `returns`, `wishlist`, `compare`, `payments`, `gift-and-rewards`, `gift-registry`, `company`, `purchase-orders`, `quotes`, `requisition-lists`, `query`. For a content-only project,
`"products,categories,cms"` shows an agent a handful of tools instead of 216; the Adobe Commerce groups (`returns`,
`gift-and-rewards`, `gift-registry`, `company`, `purchase-orders`, `quotes`, `requisition-lists`) can be left out of a
store that is Open Source Magento, where they would only answer "Cannot query field". Names are case-insensitive; a name
that is not a group stops the server with exit code 1 and the list of valid ones. Loading fewer groups also lowers
the server's start-up cost, because only their input schemas are built.

## 4. The customer token (optional), then check the setup

Only the `customer` group needs a token: a **customer** token, which identifies one shopper.
Get it outside this server — the `generateCustomerToken` mutation, with that shopper's
credentials, from your own terminal or a test script — and pipe it in:

```sh
echo "$CUSTOMER_TOKEN" | npx -y --package @hiberus-magento/magento-graphql hiberus-magento-graphql auth token set
```

It is written to `$XDG_CONFIG_HOME/hiberus/magento-graphql.json` at mode `0600`, and the server
reads the same file. There is no `--token` flag, so the token cannot end up in shell history.
Use a test shopper, not a real customer: what this server reads for that token reaches the model.

```sh
export MAGENTO_GRAPHQL_BASE_URL=https://demo-host.example-domain/graphql
npx -y --package @hiberus-magento/magento-graphql hiberus-magento-graphql auth status
```

`auth status` prints an 8-hex-character fingerprint of the stored token (never the token) or says
calls are anonymous, then probes one cheap `storeConfig` query. A stored file with loose
permissions is an error here too, and in the server: it is never read as "no token".

### The project's `.mcp.json`

Copy [`packages/magento-graphql/templates/mcp.json`](../packages/magento-graphql/templates/mcp.json)
into the project as `.mcp.json`, replace `<version>` with a published version and the URL with the
store's. Every variable is set so that copying it as it is changes nothing: an empty value counts as "not set".

| Variable | Set it to | Leave it as it is when |
|---|---|---|
| `MAGENTO_GRAPHQL_BASE_URL` | The store's GraphQL endpoint (section 1) | Never: this one is required |
| `MAGENTO_GRAPHQL_TOKEN` | A customer token, only on your own machine | You stored it with `auth token set`, which is the better way: **never commit a token** |
| `MAGENTO_GRAPHQL_STORE` | A store view code (section 2) | You want the default view |
| `MAGENTO_GRAPHQL_ALLOW_WRITES` | `true` to register the mutation tools (section 3) | You only read. Only the exact text `true` turns it on |
| `MAGENTO_GRAPHQL_GROUPS` | A comma-separated list such as `products,cms` (section 3) | You want every tool. An unknown name stops the server |

## 5. What the tools return, and what they do not

Each curated tool sends a fixed query and returns only what it selects, so an extension's fields
do not appear. Reach those with `magentographql_query`: read the map with
`magentographql_list_operations`, a type with `magentographql_describe_type`, then send **one
query**, values in `variables`. Magento allows introspection by default; if your store disables
it, those two tools answer with the store's own message.

The storefront schema is what a shopper sees. A disabled product, a product not visible in the
catalog, or one not assigned to the website of the store view you asked for is simply absent:
"No product matches" can mean exactly that. For back-office data use `magento-rest`.

## 6. What has been run against a real Magento

32 of the 216 tools have been, anonymously, against a local Magento with test data (the curated reads of products,
categories, CMS and the store, the generic query and schema tools, and seven generated reads: checkout agreements, route,
attributes list, reCAPTCHA v3 config, gift registry types, e-mail availability and customer group; and, with the write
switch on, a guest cart end to end: create, add, update, remove, clear, guest e-mail, shipping address, billing address,
shipping method, estimates). The other 184 are *not verified*: the customer
tools, `get_cms_blocks`, `get_cart` and every mutation, plus the rest of those generated from the schema. What was checked for
all of them is that their document is **valid against that store's schema** (each was sent with a deliberately invalid
extra field, so nothing executed, and no other error was reported). Each tool carries "Not verified against a live service" until it has been run against
a real instance and returned data; `packages/magento-graphql/src/tools/verification.ts` is the one
list. The queries follow the schema of Magento 2.4's core GraphQL modules; a store on an older
release, or one that removed a field, answers with a message naming the field.

## 7. Trying it against a local Magento

A development Magento usually answers on a made-up host name over HTTPS with a certificate from a
local authority such as `mkcert`. Make Node trust that authority instead of switching verification
off, and use the store's own host name:

```sh
export MAGENTO_GRAPHQL_BASE_URL=https://magento.local/graphql
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
node packages/magento-graphql/dist/cli.js auth status
node scripts/call-tool.mjs packages/magento-graphql/dist/mcp.js magentographql_get_store_config '{}'
```

## 8. What the common failures mean

| What you see | What it means |
| --- | --- |
| `MAGENTO_GRAPHQL_BASE_URL is required` | A configuration error. Set it and restart; `tools/list` works without it. |
| `The Magento base URL must use https` | Plain `http` for a host that is not `localhost`. |
| `Refusing to read credential file …: mode <m> has group/world permissions` | The stored token file is not `0600`. `chmod 600` it, or re-run `auth token set`. |
| `The current customer isn't authorized.` (`unauthorized`) | A customer tool without a token, or with an expired one (Magento's default lifetime is one hour). Set a fresh one. |
| `Magento GraphQL: Cannot query field "x" on type "Y"` | The store's schema does not have that field: an older release, an extension that removed it, or a typo in a `magentographql_query`. Use `magentographql_describe_type`. |
| `This tool runs queries only; the document is a mutation.` | `magentographql_query` was given a mutation or subscription. Mutations go through the cart tools, behind the write switch. |
| `The document has 2 operations; send exactly one.` | Send one operation per call. |
| `… reaches selection depth 13; the limit is 12` or `… is 8001 characters` | The document is too large; ask for less per call. |
| HTTP `429` / `502` / `503` / `504` on a query | Retried up to three times with backoff before the error reaches you. |
| `Magento GraphQL request failed with HTTP <n>.` | The body was not a Magento error (a proxy's HTML page, say). It is deliberately not echoed. |
| `magento-graphql: refusing to start — MAGENTO_GRAPHQL_GROUPS …` (exit code 1) | A name in the list is not a group; the message lists the valid ones. |
