# @hiberus-magento/magento-rest

An MCP (Model Context Protocol) server, and a companion operator CLI, for the
**Magento 2 / Adobe Commerce REST API** of one instance — catalog, orders,
customers, stock, content and store configuration — with the write tools
switched off unless you turn them on.

> **This is not EDS, ACS or ACO, and not the Magento Cloud CLI.** Adjacent names
> that are routinely confused:
>
> - **`magento-rest`** — the REST API of a running Magento instance. **This package.**
> - [`@hiberus-magento/magento-cloud`](https://npmjs.com/package/@hiberus-magento/magento-cloud) —
>   wraps the `magento-cloud` CLI for Cloud projects, environments and database.
> - **EDS** — Edge Delivery Services, the publishing platform, served by
>   [`@hiberus-magento/eds`](https://npmjs.com/package/@hiberus-magento/eds).
> - **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS.
> - **ACO** — Adobe Commerce Optimizer, served by
>   [`@hiberus-magento/aco`](https://npmjs.com/package/@hiberus-magento/aco).

Single bundled file, zero runtime dependencies, so `npx` runs it with nothing
installed first.

Its tool surface follows the functional scope of
`magento2-mcp`, rebuilt on this repository's safety primitives: bounded lists,
field allowlists on every result, encoded paths, and no way to disable TLS
verification.

## The two binaries

| Binary | What it is |
| --- | --- |
| `hiberus-magento-rest-mcp` | The **MCP server**. By default it speaks JSON-RPC over stdio: this is what you put in an MCP client's configuration. With `MAGENTO_REST_HTTP_PORT` set it serves HTTP instead (see [Running over HTTP](#running-over-http)). |
| `hiberus-magento-rest` | The **operator CLI**, for a human at a terminal. It stores the token (`auth token set`, from stdin) and checks it (`auth status`). It has no command that reads or writes catalog data. |

With two binaries declared, `npx` has to be told which one to run
(`npx -y --package @hiberus-magento/magento-rest hiberus-magento-rest-mcp`); the
bare `npx -y @hiberus-magento/magento-rest` form exits with `could not determine
executable to run`.

<!-- package:start -->

## Tools

- `magentorest_get_product_by_sku` (read-only) — Use this to read one product by its SKU: name, price, status, visibility, type, timestamps, catalog attributes and category links.
- `magentorest_search_products` (read-only) — Use this to find products whose name contains a phrase. Returns a bounded page of summaries (id, sku, name, price, status, type) and the total count.
- `magentorest_advanced_product_search` (read-only) — Use this to filter products on one field with a chosen comparison (eq, like, gt, gteq, lt, lteq, in, ...) and sort the result. Returns a bounded page of summaries and the total count.
- `magentorest_create_product` — Use this to create a new product. Adds a catalog record; the SKU must be unique. Does not touch stock or categories. Without website_ids it goes to the default website only: the website of store_code's store view, or the store's only website; with several websites and no store_code it refuses and asks for website_ids (magentorest_get_websites lists them).
- `magentorest_update_product` — Use this to change fields of an existing product. Only the fields you pass are sent; at least one is required. Overwrites the current values.
- `magentorest_get_product_content` (read-only) — Use this to read a product's content as one store view shows it: name, description, short description, meta title and meta description, and each image's id, file and label. Each value is the store view's own or the one it inherits, null when there is none. An unknown SKU returns found: false. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_update_product_content` — Use this to change a product's content in ONE store view: any of name, description, short description, meta title and meta description, and image labels by id. Only the values that differ from the current ones are sent; the result is the content read back. A store view is required (all and admin are refused). Requires Magento 2.4.7 or later. Side effect: Magento then writes a store-view value for every image of the product, so those images stop inheriting later changes made to the default values in this store view. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_update_product_attribute` — Use this to set ONE attribute of a product by code (name, price, status, description, a custom attribute, ...). Overwrites the current value. The identity attributes sku, id, entity_id and type_id are refused.
- `magentorest_delete_product` — Use this to permanently delete a product by SKU. Irreversible: the product, its images and its URL rewrites are removed.
- `magentorest_assign_product_to_category` — Use this to add a product to a category at a position. Adds a link; if the product is already in the category, its position is replaced. It does not move the product out of other categories.
- `magentorest_remove_product_from_category` — Use this to remove a product from one category. The product itself and its other category links are kept.
- `magentorest_get_store_configs` (read-only) — Use this to read each store view's configuration: code, locale, base currency, timezone, weight unit and base URLs.
- `magentorest_get_store_views` (read-only) — Use this to list every store view with its code, name, website, store group and whether it is active.
- `magentorest_get_websites` (read-only) — Use this to list every website with its code, name and default store group.
- `magentorest_get_store_groups` (read-only) — Use this to list every store group with its website, root category and default store view.
- `magentorest_get_countries` (read-only) — Use this to list the countries Magento knows, with ISO codes, English names and their regions.
- `magentorest_get_currency_info` (read-only) — Use this to read the base and display currency, the available currency codes and the exchange rates.
- `magentorest_get_category_tree` (read-only) — Use this to read the category structure under a root category as a flat list: each node has its id, parent_id, name, level, position, product count and whether it is active. Capped at 500 nodes; truncated says when the cap cut it short.
- `magentorest_get_category_by_id` (read-only) — Use this to read one category by its numeric ID: name, parent, level, position, product count, children, URL path and catalog attributes.
- `magentorest_list_categories` (read-only) — Use this to find categories, optionally by parent, by a phrase in the name, or by active status. Returns a bounded page and the total count.
- `magentorest_get_products_in_category` (read-only) — Use this to list the products assigned to one category. Returns a bounded page of product summaries (id, sku, name, price, status, type) and the total count.
- `magentorest_create_category` — Use this to create a category under a parent. Adds a record; it does not assign any product to it.
- `magentorest_update_category` — Use this to change fields of an existing category. Only the fields you pass are sent; at least one is required. Overwrites the current values.
- `magentorest_delete_category` — Use this to permanently delete a category and its subcategories by ID. Irreversible; the products stay in the catalog but lose the assignment.
- `magentorest_move_category` — Use this to move a category under a different parent, optionally right after a sibling. Changes the category tree and the URL paths below it.
- `magentorest_get_customer_by_id` (read-only) — Use this to read one customer by numeric ID: group, website, store and the default address IDs, plus name and email only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true. Date of birth, tax number and the address book are not returned.
- `magentorest_search_customers` (read-only) — Use this to find customers by part of the email or name, by group or website, or by creation date range (YYYY-MM-DD). Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_get_customer_groups` (read-only) — Use this to list the customer groups with their code and tax class.
- `magentorest_get_customer_addresses` (read-only) — Use this to list a customer's addresses by location: country, region and which is the default billing or shipping address, plus city and postcode only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true. Street, telephone and the addressee are not returned.
- `magentorest_create_customer` — Use this to create a customer account from an email and a name. It takes no password: Magento's own password-reset flow is how the customer sets one. Adds a record; the email must not already exist on the website. Magento EMAILS the customer a welcome message to set a password; no input stops it (only the store's disable-email-communications setting does).
- `magentorest_update_customer` — Use this to change a customer's email, name or group. Only the fields you pass change; at least one is required. Overwrites the current values.
- `magentorest_delete_customer` — Use this to permanently delete a customer account by ID. Irreversible: the account and its address book are removed; past orders keep their own copy of the details.
- `magentorest_get_order_by_id` (read-only) — Use this to read one order by entity ID: status, state, totals, currency and the order lines; who placed it (customer ID, name, email) only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true. Billing and shipping addresses and payment details are not returned.
- `magentorest_get_order_by_increment_id` (read-only) — Use this to read one order by its order number (increment ID), the one a customer quotes. Same fields as reading by entity ID. A number with no order is reported as not-found.
- `magentorest_search_orders` (read-only) — Use this to find orders by status, customer email or ID, creation date range (YYYY-MM-DD, whole days), grand-total range and the generic filters. Filters are combined with AND. Newest first unless you sort otherwise. Returns a bounded page of summaries and the total count.
- `magentorest_list_orders` (read-only) — Use this to list orders by status, creation date range (YYYY-MM-DD, whole days), grand-total range and the generic filters, without naming a customer. Filters are combined with AND. Newest first unless you sort otherwise. Returns a bounded page of summaries and the total count. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_order_items` (read-only) — Use this to list the lines of one order: SKU, name, quantities ordered, shipped, invoiced and refunded, price and row total, tax and discount.
- `magentorest_get_order_comments` (read-only) — Use this to read an order's status history: each entry's status, comment text, date and whether the customer was notified or can see it.
- `magentorest_add_order_comment` — Use this to add a comment to an order's history, optionally moving it to another status. A status given becomes the order's own status (it must be one the order's current state allows). Silent and hidden from the customer unless you say otherwise: setting is_customer_notified to true makes Magento EMAIL the customer. Each call adds another entry.
- `magentorest_cancel_order` — Use this to cancel an order that has not been invoiced. Changes its state to canceled and releases the reserved stock; it cannot be undone from here.
- `magentorest_hold_order` — Use this to put an order on hold, which stops it being invoiced or shipped until it is released with magentorest_unhold_order.
- `magentorest_unhold_order` — Use this to release an order from hold so it can be invoiced and shipped again.
- `magentorest_get_invoice_by_id` (read-only) — Use this to read one invoice by its numeric ID: state, totals, currency and the invoiced lines.
- `magentorest_search_invoices` (read-only) — Use this to find invoices by order, state and creation date range (YYYY-MM-DD, whole days). Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_get_shipment_by_id` (read-only) — Use this to read one shipment by its numeric ID: quantities, weight, the shipped lines and the tracking entries.
- `magentorest_search_shipments` (read-only) — Use this to find shipments by order and creation date range (YYYY-MM-DD, whole days). Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_get_creditmemo_by_id` (read-only) — Use this to read one credit memo (refund) by its numeric ID: state, totals, adjustments, currency and the refunded lines.
- `magentorest_search_creditmemos` (read-only) — Use this to find credit memos (refunds) by order, state and creation date range (YYYY-MM-DD, whole days). Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_create_invoice` — Use this to invoice an order, whole or by line. With capture set to true Magento CAPTURES the payment — the customer is charged; the default is false, which only records the invoice. Setting notify_customer to true emails the customer. Returns the new invoice ID.
- `magentorest_create_shipment` — Use this to record a shipment for an order, whole or by line, optionally with tracking numbers. Setting notify_customer to true emails the customer. Returns the new shipment ID. Shipping deducts stock from the product's source: if a product has none there, Magento answers only "Could not save a shipment" (its log says the quantity is not available), so check stock first with magentorest_get_source_items.
- `magentorest_add_shipment_tracking` — Use this to add a tracking number to an existing shipment. Adds an entry; it does not change the shipment's lines or notify the customer.
- `magentorest_create_creditmemo` — Use this to REFUND an order, whole or by line, with optional shipping and manual adjustments. Money goes back to the customer; it cannot be undone from here. Setting notify_customer to true emails the customer. Returns the new credit memo ID.
- `magentorest_get_product_stock` (read-only) — Use this to read the stock item of one product by SKU: quantity, in-stock flag, whether stock is managed, sale quantity limits and backorder setting. With multi-source inventory enabled (the usual setup now) this legacy stock item mirrors only the default source, so it can show a null or zero quantity for a product held in other sources: use magentorest_get_source_items for every source.
- `magentorest_get_low_stock_products` (read-only) — Use this to list stock items at or below a quantity threshold, for one stock scope. Items already at zero are included. Returns a bounded page and the total count. With multi-source inventory enabled (the usual setup now) this legacy stock item mirrors only the default source, so it can show a null or zero quantity for a product held in other sources: use magentorest_get_source_items for every source.
- `magentorest_get_inventory_sources` (read-only) — Use this to list the inventory sources (warehouses) of multi-source inventory: code, name, whether enabled, country, region, city, postcode and priority. Street, phone, email and contact person are not returned.
- `magentorest_get_inventory_stocks` (read-only) — Use this to list the inventory stocks of multi-source inventory with the sales channels (websites) each one serves.
- `magentorest_get_source_items` (read-only) — Use this to read a product's quantity and status in each inventory source, by SKU.
- `magentorest_update_product_stock` — Use this to set a product's stock quantity on the default stock. The in-stock flag follows the quantity (in stock when above zero) unless you set it. Overwrites the current quantity. With multi-source inventory enabled this changes the quantity of the default source (observed on a live store) and no other source; magentorest_get_source_items reads every source, and nothing here writes the others.
- `magentorest_get_cart_by_id` (read-only) — Use this to read one cart by ID: activity, item count and quantity, currency and the cart lines; the customer's identity (id, name, email, group) only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true. Addresses are not returned.
- `magentorest_search_carts` (read-only) — Use this to find carts by customer email or ID, active status, creation date range (YYYY-MM-DD, whole days) and the generic filters. Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_list_carts` (read-only) — Use this to list carts by active status, creation date range (YYYY-MM-DD, whole days) and the generic filters, without naming a customer. Filters are combined with AND. Returns a bounded page of summaries and the total count. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_cart_items` (read-only) — Use this to list the lines of one cart: SKU, name, quantity, price and product type.
- `magentorest_get_abandoned_carts` (read-only) — Use this to find abandoned carts: active, non-empty carts not updated for at least a number of days, most recently updated first. Each entry gives the item count and the dates, and names the owner (or Guest) only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true. Returns a bounded page, the total count and the cutoff used.
- `magentorest_get_cms_block_by_id` (read-only) — Use this to read one CMS block by ID, including its content (HTML), title, identifier, dates and whether it is active.
- `magentorest_search_cms_blocks` (read-only) — Use this to find CMS blocks by identifier (exact), part of the title, or active status. Filters are combined with AND. Returns a bounded page of summaries WITHOUT the content, and the total count; read one by ID for its content.
- `magentorest_update_cms_block` — Use this to change a CMS block's identifier, title, content or active flag. Only the fields you pass change; at least one is required. Overwrites the current values on the live storefront. The block ends up assigned to all store views: Magento resets a block's store assignment on every REST update.
- `magentorest_delete_cms_block` — Use this to permanently delete a CMS block by ID. Irreversible: it disappears from the storefront immediately.
- `magentorest_get_cms_page_by_id` (read-only) — Use this to read one CMS page by ID, including its content (HTML), title, identifier, dates and whether it is active.
- `magentorest_search_cms_pages` (read-only) — Use this to find CMS pages by identifier (exact), part of the title, or active status. Filters are combined with AND. Returns a bounded page of summaries WITHOUT the content, and the total count; read one by ID for its content.
- `magentorest_update_cms_page` — Use this to change a CMS page's identifier, title, content or active flag. Only the fields you pass change; at least one is required. Overwrites the current values on the live storefront. The page keeps its store assignment.
- `magentorest_delete_cms_page` — Use this to permanently delete a CMS page by ID. Irreversible: it disappears from the storefront immediately.
- `magentorest_create_cms_block` — Use this to create a CMS block. Adds a block for all store views (Magento's REST body takes no store assignment) that is active unless you say otherwise.
- `magentorest_create_cms_page` — Use this to create a CMS page at a URL key. Adds a page for all store views (Magento's REST body takes no store assignment) that is active, with a one-column layout, unless you say otherwise.
- `magentorest_get_product_attribute` (read-only) — Use this to read one product attribute by code: its input type, scope, flags (required, searchable, filterable, comparable), options and store labels.
- `magentorest_search_product_attributes` (read-only) — Use this to find product attributes by part of the code, input type (text, select, multiselect, boolean, ...), or the searchable and filterable flags. Filters are combined with AND. Returns a bounded page of summaries and the total count.
- `magentorest_get_attribute_options` (read-only) — Use this to list the options of a select or multiselect attribute as label and value pairs.
- `magentorest_get_attribute_sets` (read-only) — Use this to list the product attribute sets with their ID, name and sort order. Returns a bounded page and the total count.
- `magentorest_get_attribute_set_attributes` (read-only) — Use this to list the attributes that belong to one attribute set, as summaries (code, input type, label, required, searchable, filterable).
- `magentorest_add_attribute_option` — Use this to add an option to a select or multiselect attribute. Adds an option that is not the default; it does not assign it to any product. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_product_media` (read-only) — Use this to list a product's media entries (images and videos): ID, type, label, position, whether hidden, the roles it plays and its file path.
- `magentorest_get_product_media_entry` (read-only) — Use this to read one media entry of a product by its entry ID.
- `magentorest_add_product_image` — Use this to add an image to a product from base64 data (at most 2,000,000 characters, JPEG, PNG, GIF or WebP). Adds a media entry; it does not remove existing ones. Returns the new entry ID.
- `magentorest_update_product_media` — Use this to change a media entry's label, position, roles or hidden flag. Only the fields you pass change; at least one is required. Overwrites the current values.
- `magentorest_delete_product_media` — Use this to permanently delete one media entry of a product. Irreversible: the image stops showing on the storefront.
- `magentorest_get_sales_rules` (read-only) — Use this to list the cart price rules (promotions): name, dates, whether active, discount type and amount, coupon type, usage limits, websites and customer groups. Returns a bounded page and the total count. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_sales_rule_by_id` (read-only) — Use this to read one cart price rule by ID: its dates, discount, coupon type, usage limits, websites and customer groups. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_search_coupons` (read-only) — Use this to find coupons by part of the code and by the rule they belong to. Filters are combined with AND. Returns a bounded page and the total count; each coupon shows its code, limits, times used and expiry. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_coupon_by_id` (read-only) — Use this to read one coupon by ID: its code, rule, limits, times used and expiry. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_delete_coupon` — Use this to permanently delete one coupon by ID. Irreversible: customers holding that code can no longer redeem it. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_tax_rates` (read-only) — Use this to list the tax rates: code, rate, country, region and postcode (or postcode range). Returns a bounded page and the total count.
- `magentorest_get_tax_rules` (read-only) — Use this to list the tax rules: code, priority, and the customer tax classes, product tax classes and tax rates each one combines. Returns a bounded page and the total count. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_get_tax_classes` (read-only) — Use this to list the tax classes, optionally only the CUSTOMER or only the PRODUCT ones. Returns one page of up to 100 and the total count.
- `magentorest_get_revenue` (read-only) — Use this to total the revenue of a period: revenue, currency, order count, average order value and tax. Computed from the orders in the period; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial. With no status it leaves out canceled and closed orders. Amounts in different currencies are never added together: when the orders span several, the totals are null and by_currency gives each currency's own totals.
- `magentorest_get_order_count` (read-only) — Use this to count the orders of a period, optionally by status. The count is Magento's own total, so it is exact and is never partial.
- `magentorest_get_product_sales` (read-only) — Use this to see what sold in a period: orders, items, units, revenue, and the ten best-selling products by quantity with their revenue. Optionally for one country (billing or shipping). Computed from the orders; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial. With no status it leaves out canceled and closed orders. Amounts in different currencies are never added together: when the orders span several, the revenue figures are null and by_currency gives each currency's own revenue and order count.
- `magentorest_get_revenue_by_country` (read-only) — Use this to total the revenue of a period for one country (orders billed or shipped there): revenue, currency, order count, average order value and tax. Computed from the orders; it returns no order details. Reads at most max_pages pages of 100 orders and says when the result is partial. With no status it leaves out canceled and closed orders. Amounts in different currencies are never added together: when the orders span several, the totals are null and by_currency gives each currency's own totals.
- `magentorest_get_customer_ordered_products_by_email` (read-only) — Use this to list every order of one customer, found by exact email, with each order's lines (SKU, name, price, quantity). Returns the customer's id, name and email only when the server runs with MAGENTO_REST_CUSTOMER_DATA=true, never their addresses. For a product's own detail use magentorest_get_product_by_sku. Reads at most max_pages pages of 100 orders and says when the result is partial.
- `magentorest_db_status` (read-only) — Use this to check that the database connection works: returns the server version, the database name, that the session is read-only, and whether database writes are enabled. Run it first when a database tool fails. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_list_tables` (read-only) — Use this to list the tables of the Magento database, optionally only those whose name contains a fragment (e.g. `sales_order`). Returns each table's name, engine and approximate row count (an estimate, not a count: use magentorest_db_stats or a COUNT(*) for exact figures). **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_describe_table` (read-only) — Use this to see the columns of one table: name, type, whether it can be NULL, key, default and extra. Refuses the tables that hold credentials (administrators, OAuth tokens, integrations). **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_query` (read-only) — Use this for a question the other tools cannot answer: runs ONE read-only SELECT and returns its columns and rows. Name the columns (SELECT * and TABLE are refused; COUNT(*) and a * b are fine), pass values as ? placeholders in params (?? identifier placeholders are refused; a literal in the SQL must be single-quoted, without backslashes, never double-quoted), and expect at most max_rows rows (default 100, at most 500): a LIMIT above that is refused, and LIMIT max_rows is added when the statement has none. No comments, no second statement, no INTO, no locking reads, no credential tables (administrators, OAuth tokens, integrations, sessions, ACL; table prefixes included), and no column named like a password, hash or token anywhere in the statement; values of such columns that reach the result anyway (a view, an alias), and of secret configuration rows, come back as [redacted]. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_magento_tables` (read-only) — Use this to see the well-known Magento 2 tables grouped by what they hold (products, categories, customers, orders, quotes, invoices, shipments, CMS, EAV, URL rewrites, store), each marked with whether it exists in this database. Table prefixes are not applied. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_product_by_sku` (read-only) — Use this for a quick look at one product straight from the database: id, SKU, type, created and updated dates, quantity and in-stock flag (legacy stock table). For the full product use magentorest_get_product_by_sku. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_recent_orders` (read-only) — Use this to see the latest orders straight from the database: id, increment id, status, state, customer email and name, totals, currency and dates. Newest first; limit defaults to 10, at most 100. Never returns addresses or payment data. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_stats` (read-only) — Use this to count the rows of the key tables in one call: products, categories, customers, orders, order items, quotes, CMS pages and blocks. A table that does not exist says so. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.
- `magentorest_db_execute` — Use this ONLY when no other tool can make the change: runs ONE INSERT, UPDATE or DELETE (UPDATE and DELETE need a WHERE) in a transaction. It bypasses Magento's own validation, indexing and events, so a change made here may not show on the storefront until a reindex and cache flush. Try it first with dry_run=true: the statement runs and is rolled back, and you see how many rows it would change. It rolls back by itself, changing nothing, if more than max_affected rows (default 100, at most 10000) would change. No DDL (DROP, ALTER, TRUNCATE), no REPLACE, no comments, no credential tables. Irreversible once committed. **Not verified against a live service** — this tool has not been run against a real Magento instance; its request shape and response projection are covered by unit tests against a test double and by the conformance suite.

## Environment

- `MAGENTO_REST_BASE_URL` (required) — The Magento REST root every magentorest_* tool addresses, e.g. https://<host>/rest/V1 (or /rest/<store-code>/V1 for one store view). Resolved on the first tool call and refused without it; tools/list still works. Must be https — plain http is accepted only for localhost.
- `MAGENTO_REST_TOKEN` (optional) — A Magento integration access token or admin token, sent as a Bearer. Every tool call needs one, but it may come from this variable OR from the credential file written by `hiberus-magento-rest auth token set`, so neither source is required on its own.
- `MAGENTO_REST_FIELDS_FILE` (optional) — Path to a JSON file that adjusts the fields a resource exposes, e.g. {"product":{"add":["cost"],"remove":["weight"]}}. A resource may carry only `add` and `remove`, so a file can widen or narrow the shipped list but never replace it — and credential and payment fields (passwords, hashes, tokens, secrets, card and payment data) can never be added. Read once at startup; a file that cannot be read or does not validate stops the server with exit code 1 rather than starting with a half-applied configuration.
- `MCP_WRITES_ENABLED` (optional) — The write switch an MCP host sets itself. Exactly `true` registers the write tools (create, update, delete, cancel, invoice, refund, ...); any other value, `false` included, registers read tools only, and then MAGENTO_REST_ALLOW_WRITES is ignored. Unset, MAGENTO_REST_ALLOW_WRITES decides. Read once at startup.
- `MAGENTO_REST_ALLOW_WRITES` (optional) — The write switch for standalone use, read only when MCP_WRITES_ENABLED is unset. Set to exactly `true` to register the write tools (create, update, delete, cancel, invoice, refund, ...). Unset, or any other value, and the server registers read tools only — a write tool is then absent from tools/list, not merely refused. Read once at startup.
- `MAGENTO_REST_CUSTOMER_DATA` (optional) — Set to exactly `true` to include customer personal data in REST tool results: an order's customer ID, name and email, a cart's customer, a customer's name and email, and the city and postcode of their addresses. Unset, or any other value, and every REST tool result leaves them out, and a MAGENTO_REST_FIELDS_FILE cannot add them back. Off by default so a host that must keep personal data out of a model's context (GDPR) gets that without setting anything. The database tools (MAGENTO_REST_DATABASE_CONNECTION) are not filtered: they return what the SQL selects.
- `MAGENTO_REST_GROUPS` (optional) — Comma-separated tool groups to load, e.g. `products,customers`, so a project registers only the tools it needs instead of every one. Groups: `products`, `store`, `categories`, `customers`, `orders`, `sales-documents`, `stock`, `carts`, `cms`, `attributes`, `media`, `promotions`, `tax`, `analytics`, `database` (only with MAGENTO_REST_DATABASE_CONNECTION; naming it without one stops the server). Case-insensitive; blanks and repeats are ignored. Unset or empty loads every group (`database` too, when a connection is configured). A name that is not a group stops the server with exit code 1, listing the valid ones. The write switch (MCP_WRITES_ENABLED, or MAGENTO_REST_ALLOW_WRITES when it is unset) still decides whether the write tools of a loaded group are registered. Read once at startup.
- `MAGENTO_REST_DATABASE_CONNECTION` (optional) — Adds the `database` tool group (magentorest_db_*): direct, read-only access to the Magento database. A URL with NO password, e.g. `mysql://reader@127.0.0.1:3306/magento`; a password in it stops the server. A host that is not this machine uses verified TLS unless you write `?ssl=false`. Unset, there are no database tools. Use a database user with the narrowest grants you can: SELECT only unless you also enable writes. The URL is validated at startup (exit code 1 if it is invalid); the password is only needed when a tool is called.
- `MAGENTO_REST_DATABASE_PASSWORD` (optional) — The password of the database user, used by the database tools. It may come from this variable OR from the credential file written by `hiberus-magento-rest auth db-password set` (read from stdin, mode 0600), so neither source is required on its own. Resolved on every connection, so a stored password applies without a restart.
- `MAGENTO_REST_DATABASE_ALLOW_WRITES` (optional) — Set to exactly `true` to register magentorest_db_execute (one INSERT, UPDATE or DELETE per call, in a transaction, with a dry run and a cap on rows changed). A switch of its own: MAGENTO_REST_ALLOW_WRITES does not enable it. Unset, or any other value, and the tool is absent from tools/list. Without MAGENTO_REST_DATABASE_CONNECTION it stops the server with exit code 1. Read once at startup.
- `MAGENTO_REST_HTTP_PORT` (optional) — Set to serve MCP over HTTP instead of stdio, for callers that cannot own a child process (for example a PHP middleware or a queue consumer). Opt-in: unset or blank and the server speaks stdio exactly as before. `0` picks a free port, which is logged to stderr as `magento-rest: listening on http://<host>:<port>/mcp`. Stateless: one POST per call, no session, JSON replies. Requires MAGENTO_REST_HTTP_TOKEN. Read once at startup. Headers, examples and status codes: docs/http-mode.md.
- `MAGENTO_REST_HTTP_TOKEN` (optional) — Bearer token the HTTP caller must send as `Authorization: Bearer <token>`. Required when MAGENTO_REST_HTTP_PORT is set; at least 32 characters (generate one with `openssl rand -hex 32`), otherwise the server stops with exit code 1. Read from the environment only, never from argv, and never logged or echoed. Rotating it means restarting the server.
- `MAGENTO_REST_HTTP_HOST` (optional) — Interface the HTTP endpoint binds to. Default `127.0.0.1` (loopback only). Set it to `0.0.0.0` or a container address only when the server must be reached from another host, and then list the names callers use in MAGENTO_REST_HTTP_ALLOWED_HOSTS.
- `MAGENTO_REST_HTTP_ALLOWED_HOSTS` (optional) — Comma-separated extra `Host` header values the HTTP endpoint accepts, for example `magento-rest:3000`, beyond loopback with the bound port. A request with any other Host is refused with 403 (DNS rebinding protection).
- `MAGENTO_REST_HTTP_ALLOWED_ORIGINS` (optional) — Comma-separated `Origin` values the HTTP endpoint accepts. Unset, any request that carries an Origin header is refused with 403: this server is for backends, not browsers.

## Configure in an MCP client

Pin the exact version; pass secrets as environment variable references, never literal values:

```json
{
  "mcpServers": {
    "hiberus-magento-rest-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@hiberus-magento/magento-rest@0.4.1",
        "hiberus-magento-rest-mcp"
      ],
      "env": {
        "MAGENTO_REST_BASE_URL": "${MAGENTO_REST_BASE_URL}"
      }
    }
  }
}
```

<!-- package:end -->

## Running over HTTP

For a caller that cannot launch a child process (a PHP middleware, a queue consumer), set a port and a
token and the server listens on `http://127.0.0.1:<port>/mcp` instead of stdio:

```sh
export MAGENTO_REST_BASE_URL=https://demo-host.example-domain/rest/V1
export MAGENTO_REST_HTTP_PORT=3200
export MAGENTO_REST_HTTP_TOKEN="$(openssl rand -hex 32)"
npx -y --package @hiberus-magento/magento-rest hiberus-magento-rest-mcp

curl -s http://127.0.0.1:3200/mcp \
  -H "Authorization: Bearer $MAGENTO_REST_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"magentorest_get_store_configs","arguments":{}}}'
```

`MAGENTO_REST_HTTP_TOKEN` is the secret HTTP callers send; it is not the Magento token, which still comes
from `MAGENTO_REST_TOKEN` or the stored file (see [Credentials](#credentials)). Each call is one `POST` with
a JSON-RPC body: no `initialize`, no session. All three headers are required; without that `Accept` value
the reply is `406`. A tool that fails answers HTTP `200` with `"isError": true`. The
[HTTP mode guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/http-mode.md) has the
status codes, the setup for reaching it from another container, and its limits (one store per process, the
integration's identity on every call).

### A store that adds the store code to its URLs

With *Add Store Code to Urls* on, Magento answers `/rest/...` with a redirect to
`/<store code>/rest/...`. Redirects are never followed (that would re-send the
token somewhere you did not configure): the call fails with `invalid_argument` on
`MAGENTO_REST_BASE_URL`, and its message names the base URL to use instead, for
example `https://<host>/es/rest/all/V1`.

## Credentials

A Magento **integration Access Token** (or an admin token), sent as a Bearer. It
comes from `MAGENTO_REST_TOKEN`, or from `$XDG_CONFIG_HOME/hiberus/magento-rest.json`
at file mode `0600` — an alternative to putting a secret in any config file or
shell variable:

```sh
echo "$MAGENTO_TOKEN" | npx -y --package @hiberus-magento/magento-rest hiberus-magento-rest auth token set
```

There is no `--token` flag: it is absent, not rejected, so a token cannot reach
shell history. A stored file with group or world permissions is refused, not
warned about, and the message names the file. With no token the call fails at
once with the command, the variable and the path it looked at — it never waits
for input. The token is read on every call, so adding or replacing one takes
effect without a restart.

## Read-only by default

With `MCP_WRITES_ENABLED` and `MAGENTO_REST_ALLOW_WRITES` unset, or set to anything
but the exact string `true`, the server registers **read tools only**. An MCP host
sets `MCP_WRITES_ENABLED` itself; when it is present it decides alone, and
`MAGENTO_REST_ALLOW_WRITES` (the switch for standalone use) is ignored. A write tool is then absent from
`tools/list`, not merely refused when called. The choice is made once at
startup. Reads that hit a `429` or `5xx` are retried with backoff; a write is
sent exactly once, because replaying an invoice or a refund after an ambiguous
failure could capture or refund twice. Use a separate, narrowly scoped
integration for the configuration that enables writes.

### Store scope of writes

Through `/rest/V1`, Magento runs a request as the **default store view**. A
product or category saved that way gets values for that one store view, and a
CMS block or page saved without a store assignment is assigned to that one
store view. So:

- the catalog writes (`create_product`, `update_product`,
  `update_product_attribute`, `add_product_image`, `update_product_media`,
  `create_category`, `update_category`) run in the **`all`** scope by default:
  they change the global values every store view inherits. A store view that
  already has its own value keeps it. Pass `store_code` to change one store
  view's own value instead;
- `create_product` always sends the website: `website_ids` when given, else the
  **default website only** — the website of the `store_code` store view, or the
  store's only website. Magento's REST API does not say which website is the
  default, so with several websites and no `store_code` the tool refuses and asks
  for `website_ids` (left alone, Magento would put a product created in the
  global scope on every website);
- the CMS creates and updates always run in `all`, so a new block or page is on
  all store views. A page update keeps the page's store assignment. A **block**
  update does not: Magento resets a block's assignment on every REST update
  (here, to all store views), and its REST interface can neither read nor set
  one, so change a block that belongs to some store views only in the admin;
- reads, and writes with no store-scoped values (orders, invoices, stock,
  deletes, category moves), use `MAGENTO_REST_BASE_URL` as configured.

The scoped URL is built from the base URL, `/rest/<scope>/V1`, so a store-scoped
write needs a base URL ending in `/rest/V1` or `/rest/<store-code>/V1`. An
unknown `store_code` is answered as not found. Checked against the Magento
2.4.5–2.4.8 source, not yet against a live multi-store instance.

### A SKU that contains `/`

A SKU is sent as one URL path segment, so a `/` in it travels encoded as `%2F`.
Apache with its default `AllowEncodedSlashes Off` answers **404** to such a
URL before Magento sees it, and the tool reports the product as not found.
This affects every tool that takes a SKU in the path, writes included. If your
SKUs contain `/` and the store runs behind Apache, set
`AllowEncodedSlashes NoDecode` on the virtual host. Without that, only finding
the product works: `magentorest_advanced_product_search` with `field: sku`
returns its summary, because the SKU then travels in the query string. Not
checked against a live Apache.

## What a read returns

Every read tool declares an `outputSchema` and answers with `structuredContent`,
mirrored exactly as JSON text:

```json
{
  "result": { "increment_id": "000000042", "status": "processing", "grand_total": 59.9 },
  "provenance": {
    "endpoint": "GET /rest/V1/orders/42",
    "api_version": "V1",
    "read_at": "2026-11-23T10:00:00.000Z",
    "store_view": "default"
  }
}
```

`result` is the projected answer (its fields are the tool's allowlist, so the
schema is derived from it). `provenance` says where and when the data was read:
`endpoint` is the method and path from `/rest` on, with no host, query string or
token; `endpoints` lists each distinct one when a tool used several; `read_at` is
when Magento answered; `store_view` appears when the URL named one. `all` is the
global scope, not a store view, so a base URL of `https://<host>/rest/all/V1`
(useful where only `/rest/all/V*` bypasses a CDN) gives no `store_view`. A result whose
JSON is over 100,000 bytes is refused with an error: ask for fewer records. Write
tools answer with text, as before.

A failed call, read or write, answers `isError` with a typed
`structuredContent.error`: `code` (`unauthorized`, `permission_missing`,
`rate_limited`, `timeout`, `unavailable`, `invalid_argument`, `not_found` or
`upstream_error`) and the member that code needs (`resource`, `retry_after_ms`,
`http_status` or `argument`). An argument the tool's schema refuses is
`invalid_argument` with `argument` naming it, e.g. `order_id` or
`filters.0.field`.

## Customer data is off by default

Results carry **no customer personal data** unless the server runs with
`MAGENTO_REST_CUSTOMER_DATA=true`: no names, email, phone, street, date of birth,
tax number, gender or IP, no `customer_*` identity on an order, no `customer` on a
cart, and no city or postcode on a customer's addresses. An order still has its
number, status, totals and lines. A `MAGENTO_REST_FIELDS_FILE` cannot add these
fields back while the switch is off. The database tools are not filtered: they
return what their SQL selects.

## Filtering and sorting lists

Every list tool that reads through Magento's `searchCriteria` also takes
`filters` and `sort`:

```json
{
  "filters": [
    { "field": "status", "value": "processing" },
    { "field": "grand_total", "condition": "gteq", "value": 100 },
    { "field": "store_id", "condition": "in", "value": [1, 2] }
  ],
  "sort": { "field": "grand_total", "direction": "DESC" }
}
```

- `field` is one of the tool's own columns, by Magento's name for it
  (`entity_id`, not the `id` a result shows); the tool's input schema lists them.
  No list holds a column that identifies a customer (email, name, customer ID, ...),
  so a filter cannot select by person.
- `condition` is `eq` (the default), `neq`, `like` and `nlike` (`%` is the
  wildcard), `in` and `nin` (`value` is an array), `gt`, `gteq`, `lt`, `lteq`,
  `from`, `to`, `null` and `notnull` (no `value`), or `finset`.
- Filters are combined with AND, at most 10. A tool's own inputs (`status`,
  `date_from`, ...) are ANDed with them too, also on the same column: a pair that
  cannot both hold answers an empty page.
- `sort` defaults to descending; without it each tool keeps its own order.
  `search_orders` and `advanced_product_search` still take `sort_field` and
  `sort_direction`; passing those and `sort` together is refused as
  `invalid_argument` on `sort`. `search_orders` now sorts only on its listed
  columns.
- `list_orders` and `list_carts` are `search_orders` and `search_carts` without
  the customer email and ID inputs, for a host that refuses a tool able to
  select by customer.
- `get_sales_rules` takes `active_on` (`YYYY-MM-DD`): it keeps the rules whose
  stored dates span that day, `from_date` on or before it and `to_date` empty or
  on or after it. These are the dates the rule row stores. On Adobe Commerce with
  content staging a scheduled update may not show in them, so `active_on` does
  not promise the rule applies that day. `from_date` and `to_date` are still not
  in the generic `filters` list.

## Product content per store view

`magentorest_get_product_content` reads a product's name, description, short
description, meta title and meta description, and each image's `id` (a decimal
string), `file` and `label`, as one store view shows them: its own value, or the
one it inherits, or `null` when there is none. An unknown SKU returns
`found: false`; an unknown store view is an `invalid_argument` error on
`store_view`.

`magentorest_update_product_content` (a write tool) changes any of those values in
**one** store view: `all`, `admin`, an empty or a missing `store_view` are refused
before anything is sent. It reads the product first, so an unknown SKU or image is
a `not_found` error and no product is ever created; checks lengths (255 characters
for the name, meta title, meta description and labels; 65,535 bytes for the
descriptions), because Magento would silently truncate, and refuses an empty value
(clearing a store view's value is not supported) or the same image twice; sends only the values
that differ from what it read (the full media entry for a changed label); and
returns the content read back. Repeating the same call sends nothing.

**Requires Magento 2.4.7 or later.** Magento 2.4.6 pins at store-view level a sent
value equal to the inherited one, and the patch version cannot be read over REST,
so this is not checked.

**Known side effect.** Magento's REST API has no way to update only some
attributes. Whenever a product is saved in a store view, Magento writes a
store-view value (label, position, hidden) for **every image of the product**,
copied from its current values. What the store shows does not change, but those
images stop inheriting later changes made to the default values in that store
view.

## Using it from an MCP host (`server.json`)

The package ships a `server.json` (the MCP registry's server manifest, schema
`2025-12-11`) in its root, and `package.json` carries the matching `mcpName`
(`io.github.hiberus-magento/magento-rest`). A host that builds its configuration
form from it sees four variables: `MAGENTO_REST_BASE_URL` and `MAGENTO_REST_TOKEN`
(required, the token secret), `MAGENTO_REST_GROUPS`, and `MCP_WRITES_ENABLED`
(boolean, default `false`). The standalone write switch, customer data, the field
file and the database are deliberately not declared, so a host's form cannot turn
them on. A host launches the bin named after the unscoped package, `magento-rest`,
which starts the MCP server (as `hiberus-magento-rest-mcp` does), so
`npx -y @hiberus-magento/magento-rest` works without naming a bin.

## Tool groups

A Magento project rarely needs every tool, and each tool an agent is shown costs
context. `MAGENTO_REST_GROUPS` loads only the groups you name; unset or empty
loads all of them (the `database` group too, but only when a database is
configured — see [Database access](#database-access)).

```json
"MAGENTO_REST_GROUPS": "products,customers"
```

Names are separated by commas, are case-insensitive, and blanks and repeats are
ignored. A name that is not a group stops the server at startup with exit code 1
and the list of valid groups, so a typo never leaves a tool set out silently.
It is read once at startup, like the write switch, and the two are independent:
a group loads its read tools always, and its write tools (marked `*`) only with
`MAGENTO_REST_ALLOW_WRITES=true`. The exception is `database`, whose one write tool
answers to its own switch (below). Naming `database` without a connection stops the
server, because the tools it names cannot exist.

| Group | Covers | Tools (`*` = write) |
|---|---|---|
| `products` | Catalog products: read, search, create, update, delete, category assignment, content per store view | get_product_by_sku, search_products, advanced_product_search, get_product_content, create_product*, update_product*, update_product_content*, update_product_attribute*, delete_product*, assign_product_to_category*, remove_product_from_category* |
| `store` | Store configuration: store views, websites, store groups, countries, currency | get_store_configs, get_store_views, get_websites, get_store_groups, get_countries, get_currency_info |
| `categories` | Category tree and the products in a category | get_category_tree, get_category_by_id, list_categories, get_products_in_category, create_category*, update_category*, delete_category*, move_category* |
| `customers` | Customers, their groups and addresses | get_customer_by_id, search_customers, get_customer_groups, get_customer_addresses, create_customer*, update_customer*, delete_customer* |
| `orders` | Orders and their comments, cancel and hold | get_order_by_id, get_order_by_increment_id, search_orders, list_orders, get_order_items, get_order_comments, add_order_comment*, cancel_order*, hold_order*, unhold_order* |
| `sales-documents` | Invoices, shipments and credit memos | get_invoice_by_id, search_invoices, get_shipment_by_id, search_shipments, get_creditmemo_by_id, search_creditmemos, create_invoice*, create_shipment*, add_shipment_tracking*, create_creditmemo* |
| `stock` | Stock and inventory (MSI sources and stocks) | get_product_stock, get_low_stock_products, get_inventory_sources, get_inventory_stocks, get_source_items, update_product_stock* |
| `carts` | Carts, including abandoned ones (read-only) | get_cart_by_id, search_carts, list_carts, get_cart_items, get_abandoned_carts |
| `cms` | CMS blocks and pages | get_cms_block_by_id, search_cms_blocks, get_cms_page_by_id, search_cms_pages, create_cms_block*, update_cms_block*, delete_cms_block*, create_cms_page*, update_cms_page*, delete_cms_page* |
| `attributes` | Product attributes, options and attribute sets | get_product_attribute, search_product_attributes, get_attribute_options, get_attribute_sets, get_attribute_set_attributes, add_attribute_option* |
| `media` | Product images | get_product_media, get_product_media_entry, add_product_image*, update_product_media*, delete_product_media* |
| `promotions` | Cart price rules and coupons | get_sales_rules, get_sales_rule_by_id, search_coupons, get_coupon_by_id, delete_coupon* |
| `tax` | Tax rates, rules and classes (read-only) | get_tax_rates, get_tax_rules, get_tax_classes |
| `analytics` | Revenue, order counts and sales figures computed from orders (read-only) | get_revenue, get_order_count, get_product_sales, get_revenue_by_country, get_customer_ordered_products_by_email |
| `database` | Direct access to the Magento database; needs `MAGENTO_REST_DATABASE_CONNECTION` | db_status, db_list_tables, db_describe_table, db_query, db_magento_tables, db_product_by_sku, db_recent_orders, db_stats, db_execute* |

## Magento permissions (ACL) per group

The integration needs the ACL resources that the REST routes behind its tools
declare in Magento's `webapi.xml`. Checked against Magento Open Source 2.4.7 and 2.4.8
and MSI 1.2.7/1.2.8: every resource a route lists is required, and Magento stores
an integration's grants per resource, so **tick each resource below itself** (a
parent node such as Sales > Operations > Orders does not grant its children at run
time). A missing one is answered `401` and reported as `permission_missing` with
the resource. Paths are under *Magento Admin* in the integration's
**API > Resource Access** tree.

| Group | Reads need | Writes also need |
|---|---|---|
| `products` | `Magento_Catalog::products` (Catalog > Inventory > Products) | `Magento_Catalog::categories` (assign/remove category); `Magento_Backend::store` (Stores > Settings > All Stores; `create_product` without `website_ids`); `Magento_Catalog::catalog` (Catalog; `update_product_content` with `images`) |
| `store` | `Magento_Backend::store`; countries and currency need nothing | — |
| `categories` | `Magento_Catalog::categories` (Catalog > Inventory > Categories); `Magento_Catalog::products` for `get_products_in_category` | — |
| `customers` | `Magento_Customer::customer` (Customers); `Magento_Customer::group` (Customers > Customer Groups) | `Magento_Customer::manage` (Customers > All Customers; update); `Magento_Customer::delete` (… > Actions > Delete); create needs nothing |
| `orders` | `Magento_Sales::actions_view` (Sales > Operations > Orders > Actions > View) | `Magento_Sales::comment`, `::cancel`, `::hold`, `::unhold` (Orders > Actions) |
| `sales-documents` | `Magento_Sales::sales_invoice`, `::shipment`, `::sales_creditmemo` (Sales > Operations > Invoices / Shipments / Credit Memos) | `Magento_Sales::invoice`, `::ship`, `::creditmemo` (Orders > Actions); tracking needs only `::shipment` |
| `stock` | `Magento_Catalog::catalog_inventory` (Catalog > Inventory); `Magento_InventoryApi::source` and `::stock` (Stores > Inventory > Sources / Stocks) | — |
| `carts` | `Magento_Cart::manage` (Carts > Manage carts) | — |
| `cms` | `Magento_Cms::block`, `Magento_Cms::page` (Content > Elements > Blocks / Pages) | `Magento_Cms::save`, `Magento_Cms::page_delete` (Pages > Save Page / Delete Page) |
| `attributes` | `Magento_Catalog::attributes_attributes` (Stores > Attributes > Product); `Magento_Catalog::sets` (… > Attribute Set) | — |
| `media` | `Magento_Catalog::catalog` (Catalog; the list); `Magento_Catalog::attributes_attributes` (one entry) | — |
| `promotions` | `Magento_SalesRule::quote` (Marketing > Promotions > Cart Price Rules) | — |
| `tax` | `Magento_Tax::manage_tax` (Stores > Taxes) | — |
| `analytics` | `Magento_Sales::actions_view`; `Magento_Customer::customer` for `get_customer_ordered_products_by_email` | — |

`hiberus-magento-rest auth status` reads the websites list, so it needs
`Magento_Backend::store`.

Two things to know when choosing a token's reach:

- **A read resource is not read-only.** Most resources above also authorize the
  matching writes over Magento's REST API (products, categories, media, attributes,
  stock, carts, CMS blocks, cart price rules). This server registers no write tool
  without its write switch, but the token itself could write; only orders,
  customers, CMS pages and creating sales documents have separate write resources.
- **The content pair needs little.** `magentorest_get_product_content` needs only
  `Magento_Catalog::products`; `magentorest_update_product_content` needs
  `Magento_Catalog::products`, plus `Magento_Catalog::catalog` when it changes image
  labels. Ticking *Catalog* in the admin tree also ticks everything under it: untick
  what the token should not have.

Note: `Magento_CatalogInventory::cataloginventory` is the inventory *configuration*
section, not the stock API, and `Magento_UrlRewrite::urlrewrite` is used by no
tool here.

## Database access

The REST API cannot answer every question cheaply — a count, a join, a table's
columns. `MAGENTO_REST_DATABASE_CONNECTION` adds nine tools that read the Magento
database directly (the `database` group). They are a second choice: for anything the
`magentorest_get_*` tools can answer, use those, because they go through Magento's own
rules and return only reviewed fields.

```json
"MAGENTO_REST_DATABASE_CONNECTION": "mysql://reader@127.0.0.1:3306/magento"
```

**The connection has no password, on purpose.** The string is committed with the project,
so a password in it stops the server (and is never printed). Give the password with
`MAGENTO_REST_DATABASE_PASSWORD`, or store it once, from stdin, in a file only you can read:

```sh
printf '%s' "$DB_PASSWORD" | hiberus-magento-rest auth db-password set
```

A host that is not this machine uses TLS with certificate verification; write `?ssl=false`
to say, explicitly, that it does not. The URL is checked at startup; the password is only
needed when a tool is called.

**Reads** (eight tools) run in a `READ ONLY` session, with a 15 second timeout and a cap on
rows. `db_query` takes one `SELECT`: name the columns (`SELECT *` is refused under any
modifier, and so is `TABLE t`; `COUNT(*)` and `a * b` are fine), pass values as `?`
parameters, expect at most `max_rows` (default 100, at most 500). Values are bound by the
database server as a prepared statement, never pasted into the SQL text. A literal written in
the SQL must be single-quoted and contain no backslash; double quotes are refused, because
what they and a backslash mean depends on the server's SQL mode.
A `LIMIT` above `max_rows` is refused; a statement without one gets `LIMIT max_rows` added.
It refuses comments, a second statement, `INTO`, locking reads (`FOR UPDATE`, `FOR SHARE`,
`LOCK IN SHARE MODE`), `??` identifier placeholders, and the functions that read files or
stall the server. It will not touch the tables that hold credentials (administrators, OAuth
tokens, integrations, two-factor settings, sessions, ACL roles and rules — also under a table
prefix, so `mg_admin_user` is refused like `admin_user`) or the `mysql` schema, and it refuses
any column named like a password, hash or token wherever it is written (selected, aliased,
inside an expression or in a `WHERE`). The value of such a column that reaches the result
anyway (through a view or an alias, judged by the column's original name), and of a
configuration value whose path is a secret, is not in the result, or may belong to another
row (the configuration table joined to itself), comes back as `[redacted]`. The other seven tools use fixed statements.

**Writes** are a separate switch. `MAGENTO_REST_ALLOW_WRITES` does not enable them:

```json
"MAGENTO_REST_DATABASE_ALLOW_WRITES": "true"
```

Only the exact text `true` registers `db_execute`; without a connection it stops the server.
It runs **one** `INSERT`, `UPDATE` or `DELETE` per call (the last two need a `WHERE`), in a
transaction. `dry_run: true` runs it and rolls back, so you see how many rows it would
change; if more than `max_affected` (default 100, at most 10000) would change, it rolls back
by itself. No `DROP`, `ALTER`, `TRUNCATE`, `REPLACE` or `LOAD`, and the same rules on
values and literals as `db_query` (`?` parameters, single quotes, no backslashes). A change made this way skips
Magento's validation, indexing and events, so it may not show on the storefront until a
reindex and a cache flush.

**These rules make a mistake cheap; they are not the security boundary.** They are a
best-effort check on the text of a statement, and a check on text can have holes (an
expression such as `CONCAT(value)`, a derived table or a UNION hides which table a column
came from, so a configuration value read that way is not redacted). The boundary is
the database user. Create one for this server with `SELECT` only, without access to the
credential tables above, and add `INSERT`/`UPDATE`/`DELETE` on the tables you mean to change
only if you enable writes. Table prefixes
(`db.table_prefix`) are not applied to the fixed statements. Text is decoded as UTF-8
(`utf8mb4`); a column in another character set must be converted in the query.

## Showing more fields

Point `MAGENTO_REST_FIELDS_FILE` at a JSON file, kept in your project and
reviewed like code:

```json
{ "product": { "add": ["cost", "extension_attributes.stock_item.qty"] } }
```

The keys are resources — a kind of record, such as `product`, `order`,
`customer`, `cart` or `cms_page` — so one entry widens every tool that returns
that kind of record. The full list is in the onboarding guide, and an unknown
name is an error that lists them. The file only adds; a
credential or payment path (password, hash, token, secret, API key, card or
payment data, IBAN, private key) is refused at any depth. It is read once at
startup, and an invalid file stops the server with exit code 1 and the reason.
See the [onboarding guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/magento-rest-onboarding.md).

## What this server deliberately does not do

- **No database access unless you configure it.** Without
  `MAGENTO_REST_DATABASE_CONNECTION` the `database` group does not exist; with it,
  reads run in a `READ ONLY` session and `db_execute` needs its own switch,
  `MAGENTO_REST_DATABASE_ALLOW_WRITES`. See [Database access](#database-access).
- **No chat proxy and no embedded model client.** It is an MCP server, nothing
  else.
- **No way to turn TLS verification off.** There is no option and no honoured
  environment variable. For a private certificate authority, make Node trust it
  with `NODE_EXTRA_CA_CERTS`.
- **No plain `http`** except for `localhost`: a Bearer over plain http is a
  Bearer on the wire.
- **No unbounded output.** `page_size` is 1 to 100; a multi-page walk stops at a
  hard cap and reports `truncated: true`.
- **No raw responses.** Every read returns an allowlist of fields, so whatever
  an instance's modules add (extension attributes, payment blocks, address
  books) cannot reach the model. An operator can **add** fields with
  `MAGENTO_REST_FIELDS_FILE` (see below) but never remove from the list, never
  use a wildcard, and never add a credential or payment field.
- **No shipping-methods or payment-methods tool.** The original called
  `/shipping-methods` and `/payment-methods`, which are not standard Magento REST
  endpoints (the methods are per cart), and the first fell back to returning the
  store configuration — an answer to a different question.
- **No store assignment when creating a CMS block or page.** A live Magento refuses
  a `store_id` in that body; the write runs in the `all` scope, so the record is on
  all store views (see "Store scope of writes").
- **No URL-rewrite search.** The original called `/url-rewrite`, which is not a
  core Magento endpoint: a stock 2.4.8 answers 404.
- **No order-statuses tool.** The original called `/orders/statuses`, which is not
  a route: a live Magento reads it as `/orders/{id}` with an id of "statuses" and
  answers 400.
- **No customer password.** `magentorest_create_customer` takes none: a
  credential must not pass through the model; Magento's password-reset flow is
  how a new customer sets one.
- **No unbounded report.** The analytics tools read at most 50 pages of 100
  orders (10 by default), report how many orders they covered, and say when a
  result is partial.
- **No set-the-identity tool.** `magentorest_update_product_attribute` refuses
  `sku`, `id`, `entity_id` and `type_id`.

## Documentation

- [Repository](https://github.com/hiberus-magento/mcp-servers) — source, issues, and the other servers in this family.
- [Magento REST onboarding](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/magento-rest-onboarding.md) — creating a least-privilege integration, the base URL, the write switch, and what the failures mean.
- [HTTP mode](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/http-mode.md) — running it as an HTTP service for a backend: the headers, curl examples, status codes, containers, and its limits.
- [Team setup guide](https://github.com/hiberus-magento/mcp-servers/blob/main/docs/team-setup.md) — where MCP client configuration lives, and which file must never hold a secret.

## License

Apache-2.0. See [LICENSE](https://github.com/hiberus-magento/mcp-servers/blob/main/LICENSE).
