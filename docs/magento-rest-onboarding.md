# Magento REST onboarding

The day-one bootstrap for `@hiberus-magento/magento-rest` — the
`hiberus-magento-rest` CLI and the `hiberus-magento-rest-mcp` server. It talks
to a Magento 2 / Adobe Commerce instance's own REST API with a single Bearer
token. There is no second system to set up: one URL, one token, and one
decision about whether the agent may write.

## 1. Create a token with as little reach as the job needs

In the Magento admin, **System → Extensions → Integrations → Add New
Integration**, then **API** and choose the resources the integration may touch.
The Bearer this server sends is the integration's **Access Token** — not the
Consumer Key, Consumer Secret or Access Token Secret.

- **Start read-only.** Grant only the resources behind the tools you actually
  intend to use (catalog, sales, customers, stock, CMS). A token that lacks
  a resource is answered with a `401` (not a `403`) that names the resource it
  needed, as `(resource: Magento_Catalog::products)`; widen that one resource
  rather than granting "All".
- **Keep a separate integration for writes**, and use it only in the
  configuration that sets `MAGENTO_REST_ALLOW_WRITES=true` (§3). One token that
  can both read everything and refund orders is one token whose leak is
  expensive.
- An integration token does not expire on its own. Rotate it in the admin when
  someone who held it leaves.

### One Magento setting, or the token is refused

Since Magento 2.4.4 an integration's Access Token is **not accepted as a Bearer
token** unless one setting is on, and it is off by default. With it off, a correct
token for an Active integration with every permission is still answered `401`.
In the admin: **Stores → Configuration → Services → OAuth → Consumer Settings →
"Allow OAuth Access Tokens to be used as standalone Bearer tokens" → Yes**, save,
and flush the configuration cache. (This was the cause of a `401` met while
testing this package against a live 2.4.8-p5.) Of the four values an integration
shows, only the **Access Token** is used; the Consumer Key, Consumer Secret and
Access Token Secret are for OAuth 1.0 request signing and are not.

## 2. The base URL

`MAGENTO_REST_BASE_URL` is the REST **root**, not the store's home page:

```text
https://demo-host.example-domain/rest/V1               # default store view
https://demo-host.example-domain/rest/demo_store/V1    # one named store view
```

It must be **https**. Plain `http` is accepted only for `localhost`, because a
Bearer sent over plain http is a Bearer on the wire. A URL with credentials
embedded in it (`https://user:pass@…`) is refused: the token travels in a
header, never in the URL.

**TLS verification cannot be turned off.** There is no option for it and no
environment variable that is honoured. The server this one replaces shipped a
template that set `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables
verification for every connection in the process, not just this one. If your
development instance uses a private certificate authority, make Node trust it
instead (`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`); do not switch verification
off.

## 3. Read-only by default, and what "write mode" means

With `MAGENTO_REST_ALLOW_WRITES` unset — or set to anything but the exact string
`true` (`1`, `yes` and `TRUE` do **not** count) — the server registers **read
tools only**. A write tool is then not "refused when called"; it is **absent
from `tools/list`**, so an agent cannot be talked into calling something it was
never shown. The choice is made once, when the server starts, and logged to
stderr when write mode is on.

Write tools are marked `destructiveHint: true` where they overwrite or remove
data, so a client that prompts before destructive calls will prompt. Four kinds:

| Kind | Examples | Hints |
| --- | --- | --- |
| create | `magentorest_create_product`, `magentorest_assign_product_to_category` | not destructive, not idempotent |
| update | `magentorest_update_product`, `magentorest_update_product_attribute` | destructive, idempotent |
| delete | `magentorest_delete_product`, `magentorest_remove_product_from_category` | destructive, idempotent |
| action | cancel, hold, invoice, refund, ship | destructive, **not** idempotent |

**A write is never retried.** A read that fails with a `429` or `5xx` is retried
with backoff (three attempts); a `POST`, `PUT` or `DELETE` is sent exactly once,
because replaying an invoice or a refund after an ambiguous failure could
capture or refund twice.

### Loading only the tools a project needs (`MAGENTO_REST_GROUPS`)

The server offers more than ninety tools. A project that only reads the catalog and customers does not need the
carts, CMS or tax tools, and every tool an agent is shown takes room in its context. Name the groups
you want, separated by commas:

```json
"MAGENTO_REST_GROUPS": "products,customers"
```

Leave it empty (or remove it) to load everything. Case does not matter, and blanks and repeats are
ignored. The value is read once, when the server starts. A name that is not in the list below stops
the server with exit code 1 and prints the valid names, so a typo cannot leave a tool out unnoticed.

| Group | What it gives the agent |
|---|---|
| `products` | Read, search, create, update and delete products; assign them to categories |
| `store` | Store views, websites, store groups, countries, currency, store configuration |
| `categories` | The category tree, a category's products; create, update, move, delete categories |
| `customers` | Customers, their groups and addresses; create, update, delete customers |
| `orders` | Orders, items and comments; add a comment, cancel, hold, release |
| `sales-documents` | Invoices, shipments, credit memos; create each, add shipment tracking |
| `stock` | Product stock, low stock, inventory sources and stocks; update stock |
| `carts` | Carts and abandoned carts (read only) |
| `cms` | CMS blocks and pages; create, update, delete |
| `attributes` | Product attributes, options and attribute sets; add an option |
| `media` | A product's images; add, update, delete |
| `promotions` | Cart price rules and coupons; delete a coupon |
| `tax` | Tax rates, rules and classes (read only) |
| `analytics` | Revenue, order counts and sales figures computed from orders (read only) |
| `database` | Direct database tools (`db_status`, `db_list_tables`, `db_describe_table`, `db_query`, `db_magento_tables`, `db_product_by_sku`, `db_recent_orders`, `db_stats`, and `db_execute` only with its own write switch). Needs `MAGENTO_REST_DATABASE_CONNECTION` (section 4) |

Groups and the write switch are independent: a loaded group always brings its read tools, and its
write tools only when `MAGENTO_REST_ALLOW_WRITES` is `true` (above). `database` is the exception: its write tool answers to `MAGENTO_REST_DATABASE_ALLOW_WRITES`, and naming the group without a connection stops the server. `carts`, `tax`, `store` and
`analytics` have no write tools, so the switch changes nothing for them. The README lists the exact
tools of each group.

## 4. Store the token, then check it

Do not put the token in a config file you might commit. Pipe it in:

```sh
echo "$MAGENTO_TOKEN" | npx -y --package @hiberus-magento/magento-rest hiberus-magento-rest auth token set
```

It is written to `$XDG_CONFIG_HOME/hiberus/magento-rest.json` at mode `0600`,
and the server reads the same file. There is no `--token` flag — not a rejected
one, an absent one — so the token cannot end up in shell history.

```sh
export MAGENTO_REST_BASE_URL=https://demo-host.example-domain/rest/V1
npx -y --package @hiberus-magento/magento-rest hiberus-magento-rest auth status
```

`auth status` prints an 8-hex-character fingerprint of the stored token (never
the token) and probes one cheap authenticated read, reporting whether Magento
accepted it.

### The project's `.mcp.json`

Copy [`packages/magento-rest/templates/mcp.json`](../packages/magento-rest/templates/mcp.json)
into the project as `.mcp.json`, replace `<version>` with a published version and the
URL with the store's. It lists every variable the package reads, each one set so that
copying it as it is changes nothing: an empty value counts as "not set".

```json
{
  "mcpServers": {
    "magento-rest": {
      "command": "npx",
      "args": ["-y", "--package", "@hiberus-magento/magento-rest@<version>", "hiberus-magento-rest-mcp"],
      "env": {
        "MAGENTO_REST_BASE_URL": "https://magento.example/rest/V1",
        "MAGENTO_REST_TOKEN": "",
        "MAGENTO_REST_ALLOW_WRITES": "false",
        "MAGENTO_REST_FIELDS_FILE": "",
        "MAGENTO_REST_GROUPS": "",
        "MAGENTO_REST_DATABASE_CONNECTION": "",
        "NODE_EXTRA_CA_CERTS": ""
      }
    }
  }
}
```

| Variable | Set it to | Leave it as it is when |
|---|---|---|
| `MAGENTO_REST_BASE_URL` | The store's REST root (section 2) | Never: this one is required |
| `MAGENTO_REST_TOKEN` | The Access Token, only on your own machine | You stored it with `auth token set` (section 4), which is the better way: **never commit a token** |
| `MAGENTO_REST_ALLOW_WRITES` | `true` to register the write tools (section 3) | You only read. Only the exact text `true` turns it on |
| `MAGENTO_REST_FIELDS_FILE` | An absolute path to a reviewed JSON file (section 5) | You want the default fields. A path that cannot be read stops the server |
| `MAGENTO_REST_GROUPS` | A comma-separated list such as `products,customers` (section 3) | You want every tool. An unknown name stops the server |
| `MAGENTO_REST_DATABASE_CONNECTION` | `mysql://<user>@<host>:<port>/<database>`, no password (section 4) | You do not need direct database access |
| `MAGENTO_REST_DATABASE_PASSWORD` | The database password, only on your own machine | You stored it with `auth db-password set`, which is the better way |
| `MAGENTO_REST_DATABASE_ALLOW_WRITES` | `true` to register `db_execute` (section 4) | You only read. Only the exact text `true` turns it on |
| `NODE_EXTRA_CA_CERTS` | The path to a local certificate authority (section 7) | The store has a public certificate |

If you commit the file, commit it with the defaults above: a token, `true` or a
machine-specific path in it would apply to everyone who clones the project. There is no
variable to turn TLS verification off, and the template does not set one.

### Direct database access (`MAGENTO_REST_DATABASE_CONNECTION`)

Some questions are a count, a join or a table's columns, and the REST API answers them slowly or
not at all. A project can add the `database` group, which reads the database directly. Prefer the
REST tools whenever they can answer: they follow Magento's rules and return only reviewed fields.

1. **Create a database user for this server.** `SELECT` only, on the Magento database. That grant,
   not the server's own checks, is what keeps an agent from changing data.
2. **Put the connection in `.mcp.json`, without a password:**

   ```json
   "MAGENTO_REST_DATABASE_CONNECTION": "mysql://reader@127.0.0.1:3306/magento"
   ```

   A password in the string stops the server, and it is never printed, because this file is
   committed. A host that is not your own machine uses TLS with certificate verification;
   `?ssl=false` says, explicitly, that it does not.
3. **Store the password where only you can read it**, once:

   ```sh
   printf '%s' "$DB_PASSWORD" | hiberus-magento-rest auth db-password set
   ```

   That writes `~/.config/hiberus/magento-rest-db.json` with mode `0600`. Setting
   `MAGENTO_REST_DATABASE_PASSWORD` works too. Either is read on each connection, so a change
   needs no restart.
4. **Check it** by asking the agent to run `magentorest_db_status`: it reports the server, the
   database and that the session is read-only. A refused login, an unreachable host and a missing
   password each say which.

What the read tools will and will not do is in the README ("Database access"): one `SELECT` with
named columns and a row cap, no credential tables, and the value of any password-, hash- or
token-like column shown as `[redacted]`.

**Allowing writes** is a separate decision, with a separate switch that `MAGENTO_REST_ALLOW_WRITES`
does not imply:

```json
"MAGENTO_REST_DATABASE_ALLOW_WRITES": "true"
```

That registers `magentorest_db_execute`: one `INSERT`, `UPDATE` or `DELETE` per call, in a
transaction. Ask the agent to use `dry_run` first; a statement that would change more than
`max_affected` rows (default 100) is rolled back by itself. It also needs a database user that is
allowed to write, on only the tables you mean to change. A change made through SQL skips
Magento's validation, indexing and events, so the storefront may need a reindex and a cache flush.

## 5. What the tools return, and what they do not

Every read tool returns a **fixed allowlist of fields**, not the response as
Magento sent it. Magento adds fields — extension attributes, payment blocks,
whole address books — with every module an instance installs, and returning the
parsed body would send all of them to the model. A field that is not on the
list for that tool cannot reach the agent; widening a list is a reviewed change
to `packages/magento-rest/src/tools/shapes.ts`.

### Showing more or fewer fields (`MAGENTO_REST_FIELDS_FILE`)

The shipped lists are conservative on purpose, and a project can differ in both
directions: it may need more — a product's `cost`, a stock quantity — or less — a
field it does not want in the model's context. Widen or narrow them with a JSON file,
kept in the project's repository so the change is reviewed like any other, and point the
server at it. The two commands are `add` and `remove`, and a resource may use either or both:

```json
{
  "product": {
    "add": ["cost", "extension_attributes.stock_item.qty"],
    "remove": ["weight", "attribute_set_id"]
  },
  "website": { "add": ["sort_order"] }
}
```

Start from [`packages/magento-rest/templates/magento-rest-fields.json`](../packages/magento-rest/templates/magento-rest-fields.json),
which is exactly the file above, and point the server at it with an **absolute path**:

```sh
MAGENTO_REST_FIELDS_FILE=/path/to/project/magento-rest-fields.json
```

The keys are **resources** — a kind of entity, not a tool — so adding `cost` to
`product` shows it in every tool that returns a product. The known resources, by area:

- **Catalog:** `product`, `product_summary`, `category`, `category_tree_node`,
  `product_attribute`, `product_attribute_summary`, `attribute_option`,
  `attribute_set`, `media_entry`
- **Store:** `store_config`, `store_view`, `website`, `store_group`, `country`,
  `currency`
- **Customers:** `customer`, `customer_summary`, `customer_address`,
  `customer_group`
- **Orders and sales documents:** `order`, `order_summary`, `order_item`,
  `order_status_history`, `invoice`, `invoice_summary`,
  `shipment`, `shipment_summary`, `shipment_track`, `creditmemo`,
  `creditmemo_summary`
- **Stock:** `stock_item`, `inventory_source`, `inventory_stock`, `source_item`
- **Carts:** `cart`, `cart_summary`, `cart_item`, `abandoned_cart`
- **Content:** `cms_block`, `cms_block_summary`, `cms_page`, `cms_page_summary`
- **Promotions and tax:** `sales_rule`, `coupon`, `tax_rate`, `tax_rule`,
  `tax_class`

An unknown name is an error that lists them. The analytics tools return computed
totals, not records, so they have no resource to widen. A nested field is written as a dotted path to the **leaf** you want
(`extension_attributes.stock_item.qty`), up to four levels, and only that leaf
appears, not its siblings.

The only keys a resource may carry are `add` and `remove`: a `replace`, an `only` or a
`*` is refused, so no file can swap the shipped list for "everything". `remove` has its
own limits, because narrowing cannot leak but can quietly break a tool:

- the path must be **on the shipped list** for that resource, otherwise the server does
  not start (`cannot remove "weigth" — it is not on the shipped list`), so a typo never
  passes for a removal; a path may name one leaf (`extension_attributes.category_links`) or a
  whole nested group;
- `id`, `sku`, `entity_id` and `increment_id` cannot be removed, because the tools chain on
  them: a result without them cannot be fed to the next call;
- a resource cannot be left with no fields;
- the same path, or one enclosing the other, cannot be both added and removed in one resource. A plain field passes only a primitive value — an object
under a plain name is still dropped, so name its leaves.

**There is a floor no file can lower.** A path with a segment that names a
credential or payment field — a password or hash, a token, a secret, an API key,
card or payment data, an IBAN, a private key — is refused with
`cannot be added by configuration`, at any depth and in any letter case. It errs
toward refusing (`card` also catches `discard`): a false refusal costs a code
change, a false acceptance costs a leaked credential. Personal data (an email, an
address) is deliberately **not** on that floor; whether a project may show it to a
model is that organisation's decision, so make it in a reviewed file.

The file is read **once, at startup**, and which resources were widened is logged
to stderr. **A file that cannot be read or does not validate stops the server**
with exit code 1 and the reason, instead of starting with fewer fields than you
asked for — nothing would otherwise tell you the configuration had not applied.

Lists are **bounded**: `page_size` is 1 to 100 on every search, and a tool that
walks several pages stops at a hard cap and says `truncated: true` rather than
pulling a whole order history into memory.

Not included, on purpose: direct database access (`db_query` and the other
`db_*` tools of the server this replaces). Reaching MySQL needs its own design —
a read-only database user, a read-only session, a statement timeout — and is not
part of this package.

## 6. What has been run against a real Magento

Each tool carries "Not verified against a live service" until it has been run against
a real instance and returned data (or, for a write, its effect was read back).
86 of the 93 have been, against a local Magento Open Source 2.4.8-p5 with test data;
the rest are listed in `packages/magento-rest/src/tools/verification.ts` with the
reason for each (no records to read, or an effect that cannot be undone with these tools).
Your store may differ — a customised or asynchronous store can answer a write with something that
is not the record — which is why a result that carries none of the fields a tool
reports says so instead of returning an empty object.

## 7. Trying it against a local Magento

A development Magento usually answers on a made-up host name over HTTPS with a
certificate from a local authority such as `mkcert`. Make Node trust that
authority instead of switching verification off, and use the store's own host
name — `localhost` is redirected to it, and a redirect is refused on purpose:

```sh
export MAGENTO_REST_BASE_URL=https://magento.local/rest/V1
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

Store the token (§4), then check it and call one tool by hand from the repository:

```sh
node packages/magento-rest/dist/cli.js auth status
node scripts/call-tool.mjs packages/magento-rest/dist/mcp.js magentorest_get_websites '{}'
```

A development store runs in developer mode, so a failed request carries a stack
trace with server paths in its body. This server never returns a response body, so
none of it reaches the model. Be careful what you point a write-enabled server at:
use a disposable product, category or block, and a database dump you can restore.

## 8. What the common failures mean

| What you see | What it means |
| --- | --- |
| `MAGENTO_REST_BASE_URL is required` | A *configuration* error, not a credential one. Set it and restart; `tools/list` works without it. |
| `The Magento base URL must use https` | Plain `http` for a host that is not `localhost`. Use the https URL. |
| `Missing credential for domain "magento-rest"` | No token in `MAGENTO_REST_TOKEN` and none in the credential file. The message names the exact command, variable and path. |
| `Refusing to read credential file …: mode <m> has group/world permissions` | The stored file is not `0600`. `chmod 600` it, or re-run `auth token set`. |
| HTTP `401` (`unauthorized`) | **Magento answers 401, with the same text, both for a token it does not accept and for a valid token whose integration lacks the resource the endpoint needs** (observed against a live 2.4.8). The message names that resource: `(resource: Magento_Backend::store)`. Check, in this order: the Bearer setting above is **Yes**; the integration is **Active**; the stored value is its **Access Token**, not the Consumer Key (both are 32 characters, which makes this an easy mix-up); its Resource Access includes the named resource. |
| HTTP `403` (`forbidden`) | Not what a missing permission produces on Magento. Expect it from something in front of Magento (a firewall, a WAF) or from a store-level restriction. |
| HTTP `404` (`not-found`) | The entity does not exist — or the base URL is wrong (for example a missing `/rest/V1`, or the wrong store code). **On a list it can also mean one record in the requested page is broken**: Magento fails the whole page with `No such entity with %fieldName = %fieldValue` when one record references something that was deleted (seen with a cart whose customer no longer existed). Try a smaller `page_size` or a narrower filter. |
| HTTP `429` / `502` / `503` / `504` on a read | Retried up to three times with backoff before the error reaches you. |
| `Magento REST request failed with HTTP <n>.` | The body was not a Magento error document (a proxy's HTML page, say). It is deliberately not echoed. |
| `magento-rest: refusing to start — MAGENTO_REST_FIELDS_FILE …` (exit code 1) | The field file could not be read or did not validate; the message names the path and the reason. A path that names a credential or payment field, an unknown resource, or any key other than `add` are the usual causes. |
| `magento-rest: refusing to start — MAGENTO_REST_GROUPS …` (exit code 1) | A name in the list is not a group. The message lists the valid ones; the usual cause is a typo or a plural (`product` instead of `products`). |
| `magento-rest: refusing to start — MAGENTO_REST_DATABASE_CONNECTION …` (exit code 1) | The connection string is not `mysql://<user>@<host>[:<port>]/<database>`, carries a password (remove it and use `MAGENTO_REST_DATABASE_PASSWORD` or `auth db-password set`), or has an option other than `ssl`. Also what you get from `MAGENTO_REST_DATABASE_ALLOW_WRITES=true` with no connection, or from naming the `database` group without one. |
| `The database refused the login` | The user or password is wrong, or that user may not use the database. Re-run `auth db-password set`, or check the grants. |
| `Cannot reach the database at <host>:<port>` | Nothing is listening there, or it does not accept connections from this machine. Check the host and port; a local container often publishes the database on a different port than 3306. |
| `No database password found` | Neither `MAGENTO_REST_DATABASE_PASSWORD` nor the stored file exists. The message names both. |
| `Invalid arguments: <field>: …` | The tool call was rejected before any request was sent. Every tool refuses an argument it does not declare. |

Magento's own message **templates** are kept (`No such entity with %fieldName =
%fieldValue`); the **values** its `parameters` object carries — an email, an
order id — are dropped, because those are exactly the customer data this
repository keeps out of an error message.
