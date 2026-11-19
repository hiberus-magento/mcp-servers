# Design: `magento-rest`

## Layout

```
packages/magento-rest/src/
  client/        pure: no environment, no output, no exit (purity.test.ts)
    paths.ts            restPath`...` — the only way a path is built
    search-criteria.ts  buildSearchCriteria — validated names, encoded values
    errors.ts           classifyFailure — template only, never the body
    retry.ts            decideRetry — reads only
    rate-limiter.ts     sliding-window, copied from aco (not imported)
    http.ts             createRestTransport — the only code that touches the network
    index.ts            createMagentoRestClient; the only public surface of client/
  credential-provider.ts   token from env or the 0600 file, never cached
  tools/         the adapter layer; the only place process.env is read
    rest-tool.ts        factory every tool is built through
    project.ts          allowlist projection
    shapes.ts           the named allowlists
    verification.ts     LIVE_VERIFIED_TOOLS and the shared unverified wording
    <module>-tools.ts   one per Magento area
    index.ts            assembly + the write switch
  mcp.ts  cli.ts        thin adapters
```

## Decisions

**D1 — Rewrite on `mcp-core`; do not port file by file.** The original uses
axios, dotenv, zod 3, `server.tool()` and the SDK barrel; the repository bans the
barrel, bundles with zero runtime dependencies, and uses zod 4 with
`defineTool`. A port would be a rewrite anyway, and a rewrite can carry the
guarantees below from the first line.

**D2 — `restPath` is the only path builder.** A tagged template that encodes each
interpolation as exactly one segment, and additionally encodes an all-dots segment
(`encodeURIComponent` leaves `.` alone, and `..` is resolved by URL parsing).
The transport refuses a path that does not start with `/` or that carries `?`/`#`.
*Alternative rejected:* encoding at each call site — a hundred chances to forget.

**D3 — `buildSearchCriteria` validates names and encodes values.** A name that
becomes part of a key (`field`, `sort.direction`, `conditionType`) is checked
against a closed shape; a value goes through `URLSearchParams`. It always emits an
explicit `pageSize` (default 20, max 100), so no call is an unbounded list.

**D4 — Errors keep Magento's message template and nothing else.** Magento's body is
`{message, parameters}`; `message` holds `%1` placeholders, `parameters` the values.
Only the template is surfaced (then `redact`ed and capped). A non-JSON body is not
surfaced at all, because a proxy's HTML page can name an internal host.
*One exception, found against a live 2.4.8:* Magento answers **401** — not 403 — both
for a token it does not accept and for a valid token whose integration lacks a
permission, with the same text, and names the missing ACL resource only in
`parameters.resources`. Dropping it left an operator unable to tell which
permission to grant, so on 401/403 only, that one parameter is kept when it matches
the closed shape of ACL ids (`Magento_Backend::store`, joined with `, `, at most 200
characters); anything else in `parameters` is still dropped. An ACL id is
configuration, not customer data.

**D5 — Retry reads, never writes.** `decideRetry` requires `idempotent`, set from
the method: GET only. A POST/PUT/DELETE is sent once, because replaying
`create_invoice` or `create_creditmemo` after an ambiguous failure could capture or
refund twice. `Retry-After` is honoured (capped at 10 s); backoff is full-jitter
exponential, base 250 ms, cap 4 s, three attempts.

**D6 — TLS verification has no switch.** No option, no honoured environment
variable; a source scan fails the build if the names that would disable it appear
anywhere under `src/`. A plaintext base URL is refused except for loopback, and
credentials embedded in the URL are refused. A private CA is handled with
`NODE_EXTRA_CA_CERTS`, which adds trust instead of removing it.

**D7 — Results are projected through an allowlist; the output shape is required.**
`readTool`/`writeTool` take a mandatory `shape`, so omitting one is a `tsc` error.
A plain key passes only primitives (or arrays of primitives); an object under a
plain key is dropped; a nested object needs its own shape. Own properties only.
This applies the repository rule that an undeclared field cannot reach a caller.
It is a deliberate behaviour change from the original, which returned bodies whole.

**D8 — MySQL is out of this package. SUPERSEDED by D17 (2026-11-05): the database tools are now in.** `mysql2` would have to fit a 2 MB bundle,
`dependencies: {}`, a 75 ms startup budget and a licence audit, and a free-form
`db_query` behind a prefix check does not meet this repository's SQL standard
(`magento-cloud`'s guard rejects comments, requires one statement, rejects `*`,
and caps rows). A later change can reuse that guard once it is promoted to
`mcp-core`, with a read-only database user and session and a statement timeout.

**D9 — Write tools are not registered unless `MAGENTO_REST_ALLOW_WRITES=true`.**
Absent from `tools/list`, not refused at call time, so an agent cannot be talked
into calling what it was never shown. Decided once at startup; only the exact
string `true` enables. Hints derive from the kind of effect (create / update /
delete / action), not hand-typed per tool.

**D10 — Every tool is "not verified" until it is not.** The repository convention
is that absence of the marker is not a verification badge. `LIVE_VERIFIED_TOOLS`
is the single reviewed list; the factory appends the marker to each shipped
description, and `manifest.test.ts` asserts the manifest and the shipped text agree
in both directions.

**D11 — Domain `magento-rest`.** `scripts/manifest-env.mjs` derives the environment
prefix from the domain, so every variable the package reads must start with
`MAGENTO_REST_`. `magento` would collide in meaning with `MAGENTO_CLOUD_`.

**D12 — A field file that widens or narrows, with a floor.** The allowlists of D7 are the
default, and `MAGENTO_REST_FIELDS_FILE` lets an operator widen them without
editing code. Widening what an agent can read is the same kind of switch as
turning redaction off — which this repository refuses to offer, because it is the
one a compromised environment would set — so the file is built to be hard to
misuse: a resource may carry only `add` and `remove` (no `replace`, `only` or `*`); every
path is validated against a closed shape (`[A-Za-z0-9_]{1,64}` segments, at most
four, at most 100 per resource); and credential and payment segments (password,
hash, token, secret, api key, `cc_*`, card, cvv/cvc, iban, payment, credential,
private key) are refused at any depth and in any case. `remove` was refused at
first, on the reasoning that a file should never narrow the shipped list; that was
stricter than the risk, since taking a field away cannot leak anything, and an operator
who does not want, say, a product's weight in the model's context had to edit code. It was
added on 2026-10-29 with its own limits: a path must be on the shipped list (a typo is an
error, not a silent no-op, checked against the real lists at startup), `id`, `sku`,
`entity_id` and `increment_id` cannot be removed because tools chain on them, a resource
cannot be emptied, and the same path (or one enclosing the other) cannot be both added and
removed in one resource. The credential floor does not apply to `remove`. Personal data is
deliberately NOT in the floor: whether a project may show it to a model is that
organisation's decision, made in a reviewed file. The file is keyed by RESOURCE
(a kind of entity), not by tool, so one entry widens every tool returning that
record. It is read once at startup, logged to stderr, and an invalid file stops
the server with exit code 1: starting with fewer fields than the operator asked
for is a worse failure than not starting, because nothing says the configuration
did not apply. *Alternative rejected:* an environment variable carrying the JSON
inline — it cannot be reviewed in a pull request. *Alternative rejected:* a
wildcard or an "all fields" mode — it is D7 switched off.

**D13 — Where the port deliberately differs from the original.** Reading each
module closely turned up behaviour that was wrong, ambiguous or unsafe, and it was
corrected rather than copied. All of it is UNVERIFIED against a live store, like
every tool (D10), and the places where Magento's own API shape was the reason are
marked as such.

- *Wrong number.* Revenue and sales were reported in a hard-coded `USD`; they now
  sum the base-currency amounts and report the orders' real currency (`mixed`
  with a list when there are several). Dates were resolved in the server's local
  time; they are UTC, because Magento stores UTC.
- *Unbounded.* `fetchAllPages` looped until Magento ran out of orders; every
  aggregate now takes at most `max_pages` pages of 100 (default 10, ceiling 50)
  and reports `coverage` and a `warning` when it stopped early.
  `get_customer_ordered_products_by_email` fired one product request per SKU in
  parallel with no limit; it now returns the order lines it already has.
- *Silently ignored.* A country the original did not know became a code that
  matched nothing and reported zero; it is now refused. `search_coupons` took an
  `is_active` filter it never used; the parameter is gone.
  `get_low_stock_products` and the refund adjustments were sent in a shape
  Magento's endpoint is documented not to read (`lowStock` takes `scopeId`,
  `qty`, `pageSize`, `currentPage`; a refund's adjustments and shipping amount go
  inside `arguments`), so they were probably ignored — on a refund that is money
  different from the amount asked for. They are sent in the documented shape.
- *Credential through the model.* `create_customer` took a password; it takes
  none.
- *Not ported.* `get_shipping_methods` and `get_payment_methods` call endpoints
  that are not part of core Magento's REST API and the first fell back to the
  store configuration. `search_url_rewrites` calls `/url-rewrite`, which is not part
  of core Magento either; it was first ported with a description saying so, and removed
  after a stock 2.4.8 answered 404 (D15): a tool that can only fail is not offered.
- *Looser than it looked.* Statuses, increment IDs, attribute codes, identifiers,
  dates, MIME types, file names and tax class types were free text spliced into
  paths or queries; each is a closed shape. A line list must be non-empty and
  every quantity positive. `update_product_attribute` refuses the identity
  attributes. CMS content is capped at 200,000 characters.

**D14 — A package-specific startup CPU budget, declared openly.** The shared
conformance budget is 75 ms of CPU to import and connect, derived from three
servers of six to nine tools. With 95 tools `magento-rest` measures ~72 ms (its
siblings ~54 ms on the same machine; ~28 ms to import plus ~16 ms to construct the
input schemas), which left 3 ms of margin and made the gate fail about one run in
three here. Widening the shared constant would loosen it for every package, and
trying to make the startup cheaper did not help (passing the SDK a built schema
instead of a raw shape saved nothing measurable). So `describeConformance` gained an
optional `startupCpuBudget: { ms, reason }`: the default stays 75; an override needs
a whole number of ms up to a ceiling of 200 and a reason of at least 20 characters,
and the reason is printed in the test's title so the exception is visible in the
output. `magento-rest` sets 100, derived by the budget's own formula scaled by the
measured ratio to its siblings (38.6 ms worst contended x 1.33 = 51.4; ceil(51.4 x
1.75) = 90; next 25 ms = 100). Same disclosed limitation as the original budget:
development-machine figures, not the CI runner's. *Alternatives rejected:* lazy
construction of the schemas (a race with the first `tools/list` for ~16 ms), and
splitting the package in two (changes the product's shape).

**D15 — What the first run against a live Magento changed (2026-10-26, 2.4.8-p5).**
33 read tools were run against a local development store and were the first entries in
`LIVE_VERIFIED_TOOLS`. The first run found, and this change corrected:

- *A 401 is not what it was documented to be.* Magento answers 401 — never 403 — both
  for a token it does not accept and for a valid token whose integration lacks a
  permission, with identical text; and since 2.4.4 it refuses an integration token as a
  Bearer unless "Allow OAuth Access Tokens to be used as standalone Bearer tokens" is
  on. The ACL resource id is now kept in the message (D4) and the remedy names all three
  causes. The onboarding guide had said a 403 meant a missing permission; it did not.
- *A tool for a route that does not exist.* `/orders/statuses` is read by Magento as
  `/orders/{id}` with an id of "statuses" and answered 400, so `get_order_statuses` can
  only fail. It is removed (94 tools; the original's 97 minus three).
- *Legacy stock is not the stock.* With multi-source inventory on, the stock item has a
  null quantity and every low-stock row reads 0. The three legacy stock tools now say to
  use `get_source_items`. The `lowStock` parameters (`scopeId`, `qty`, ...) were
  confirmed honoured: the total changes with the threshold.
- *Confirmed as designed:* the country filter (the order list does carry
  `billing_address` and `shipping_assignments`; United States returned exactly the 36
  orders counted independently, and an unknown country is refused), the status filters,
  the real currency, UTC day boundaries and `coverage`; `/url-rewrite` is not a core
  route (404), and the tool was removed.

**The second run (same day).** The operator confirmed the database holds test data, so the
customer-data reads and the writes were run as well, which took verification to 84 of 94 tools.
Every write was confirmed by reading the state back, on entities created for the purpose
(two categories, a product with an image, a CMS block and page) or on test records restored
afterwards; the stock of one product was raised to ship an order and put back exactly. It found
five more tools that could not have worked as the original wrote them, and four behaviours worth
knowing:

- *Never worked:* `create_cms_block` and `create_cms_page` (Magento answers 400 to a `store_id`
  in the body, fieldName `StoreId`; the argument is gone and the record is created for all store
  views); `update_product_media` (the converter is chosen by `media_type`, so a PUT without it is
  a 400; the entry is read first and its type sent back); `add_shipment_tracking` (the track row
  needs the shipment's `order_id`; the shipment is read first). With `get_order_statuses` that is
  four tools whose request could not succeed, plus the one with a route that does not exist.
- *A success that said nothing.* The test store had customised customer creation, so
  `POST /customers` answered with an acknowledgement instead of a customer. Projected through the
  customer allowlist that became `[{}]`. Stock Magento answers with the record, so no tool is
  written around that customisation; but when Magento returns something and none of it is a field
  the tool reports, the result is now a fixed notice (accepted, nothing reportable, possibly
  asynchronous, confirm with a read) that does not echo what it replaced. On 2026-10-27, once that
  store had processed its own deferred work, `create_customer` was confirmed by reading the customer
  back and `delete_customer` by reading it gone. The first delete failed with a 404 caused by a
  link the store's customisation had left; it was removed by hand in the test database, and nothing
  in the package depends on it. This took verification to 86 of 93.
- *A 404 on a list can be one broken record.* One cart in 150 references something that no longer
  exists, and any page of `/carts/search` that includes it fails with `No such entity with
  %fieldName = %fieldValue`; page_size 1 on every other position succeeds. The 404 remedy says so.
  The same test database has customers whose group does not exist (97 of 100 sampled), so saving
  them is a 404 too; for a customer whose group exists, `update_customer` changed only the field
  asked for and left the group, every other field and the addresses untouched.
- *Shipping needs stock in the source.* `Could not save a shipment` was, in Magento's log, "Not all
  of your products are available in the requested quantity" (the product had 0 in the default
  source), not a missing `source_code`; both forms failed the same way until stock existed. The
  description says so. Writing the legacy stock quantity changed the default source's quantity
  and no other.

Still marked unverified, and why, is recorded next to `LIVE_VERIFIED_TOOLS` in `verification.ts`:
`create_customer`, `delete_customer`, `add_attribute_option`, `delete_coupon`,
`get_sales_rule_by_id`, `get_coupon_by_id`, `get_sales_rules`, `search_coupons` and
`get_tax_rules`. `search_url_rewrites` is not among them: it was removed (93 tools; the original's
97 minus four).

**D16 — Tools load by group (`MAGENTO_REST_GROUPS`).** More than ninety tools cost an agent
context it often does not need, so an operator can name the groups to register. A group is a
module file (`products`, `store`, `categories`, `customers`, `orders`, `sales-documents`,
`stock`, `carts`, `cms`, `attributes`, `media`, `promotions`, `tax`, `analytics`); every tool
is in exactly one, so the groups partition the surface and naming all of them equals naming
none. Unset or empty loads everything. An unknown name stops the server with exit code 1
(the same rule as the field file: a typo must not silently leave tools out), read once at
startup. The write switch (D9) is orthogonal and applied after the group filter. The valid
names are pinned by `groups-docs.test.ts`, which fails when a group is missing from the
manifest, the README or the onboarding guide.

**D17 — Direct database tools (`MAGENTO_REST_DATABASE_CONNECTION`), reversing D8.** The operator
asked for the original's database tools, with write access available when authorised. D8's
objections are answered one by one rather than ignored:

- *Bundle, startup, licences.* `mysql2` is `devDependencies`, bundled like the SDK, and loaded by a
  dynamic `import()` on the first database call, so a server with no database configured does not
  evaluate it (startup measured +2-3 ms against a 100 ms budget). It took `mcp.js` from 1.15 MB to
  2.49 MB, over the 2 MB gate, so two modules it hardly uses are aliased to stubs (`src/stubs/`,
  the same rung as the `ajv` stubs): `iconv-lite` (539 KB of character-set tables, reached only for a
  non-UTF-8 result; the connection always asks for `utf8mb4`, and the stub fails loudly otherwise) and
  `aws-ssl-profiles` (181 KB of RDS certificates, reached only by a named TLS profile this package never
  passes). Result: 1.82 MB. CommonJS `require` inside the ESM bundle needs a `createRequire` banner
  (found by the bundle-level test, not by unit tests). Licences regenerated (seven MIT/Apache-2.0 packages).
- *A guard that is more than a prefix check.* D8 expected to reuse `magento-cloud`'s SQL guard; that
  package has none (its SQL is a relationships parser), so `db/sql-guard.ts` is new. It tokenises, then
  refuses by tokens outside quotes: one statement, no comments (including `/*! */`), SELECT only for reads
  and INSERT/UPDATE/DELETE only for writes, no `SELECT *`, no INTO/locking/variables, no file or stall
  functions, never the credential tables, a LIMIT within the cap (added when absent), a WHERE on UPDATE
  and DELETE. It lives in this package, not `mcp-core`, until a second package needs it.
- *Defence in depth, because the guard is not the boundary.* Reads open a `READ ONLY` session before any
  query, with a statement timeout; `multipleStatements` and `LOCAL_FILES` are off; TLS is verified and on by
  default for any host that is not loopback. Writes run in a transaction, can be a dry run, and roll back when
  more rows would change than `max_affected`. The real boundary is the database user's grants, and the
  documentation says so first.
- *Results cannot be allowlisted per field,* so `db/rows.ts` redacts by what a result must not hold: the value of
  credential-named columns, secret configuration rows (`core_config_data` by path), binary data, and
  credential-shaped text.
- *Two switches, deliberately.* `MAGENTO_REST_DATABASE_ALLOW_WRITES=true` registers `db_execute`;
  `MAGENTO_REST_ALLOW_WRITES` does not. Letting the REST API change an order is not letting SQL change a row.
  The write switch without a connection stops the server, as does the `database` group without one.
- *No secret in the committed file.* The connection is `mysql://user@host/db`; a password in it is refused and
  never echoed. The password is `MAGENTO_REST_DATABASE_PASSWORD` or a 0600 file written from stdin by
  `hiberus-magento-rest auth db-password set` (never argv), resolved on every connection like the REST token.

Nine tools (`db_status`, `db_list_tables`, `db_describe_table`, `db_query`, `db_magento_tables`,
`db_product_by_sku`, `db_recent_orders`, `db_stats`, `db_execute`), the first eight read-only. All are marked
unverified (D10) until run against a real database. Not carried over from the original: it accepted any statement that
merely started with SELECT, SHOW, DESCRIBE or EXPLAIN, and returned whole rows with no redaction.

## Test strategy

Strict TDD against an injected-`fetch` double keyed on `METHOD pathname[?query]`
(the shape EDS's double uses). Each module's projection is proven with
`injectLeakProbe`, which adds an undeclared field at every depth of a fake
response and asserts it is absent from what the tool returned. The built bundle
runs the shared conformance suite, and a surface test asserts `tools/list` with the
switch unset, set, and set to a value other than `true`.
