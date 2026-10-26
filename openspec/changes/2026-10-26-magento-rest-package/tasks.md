# Tasks: magento-rest

## Phase 1 — Foundation (done)
- [x] 1.1 Scaffold with `pnpm new-server magento-rest`; two bins; remove template tools
- [x] 1.2 Synthetic identifiers for Magento in `mcp-testing`
- [x] 1.3 `client/`: paths, search criteria, errors, retry, rate limiter, transport, facade, purity test
- [x] 1.4 REST fetch double and leak probe
- [x] 1.5 Credential provider (env, then 0600 file; never cached)
- [x] 1.6 Tool factory, projection, verification marker, write switch, assembly
- [x] 1.7 `mcp.ts`, `cli.ts`; conformance, surface, manifest and manifest-env tests
- [x] 1.8 Manifest entry, onboarding doc, team-setup section, package README, changeset, notices

## Phase 1b — Field configuration (done)
- [x] 1b.1 Shapes become a named registry (`BASE_SHAPES`, `RESOURCE_NAMES`); the tool factory exposes them
- [x] 1b.2 `field-config.ts`: strict additive parse, credential and payment floor, immutable merge
- [x] 1b.3 `readFieldConfigFromEnv` (64 KB cap) and the wiring through `createMagentoRestTools`
- [x] 1b.4 `mcp.ts` stops with exit code 1 on an invalid file; bundle tests for refuse, start and log
- [x] 1b.5 Manifest variable, onboarding, team-setup and README sections

## Phase 2 — Tool modules (done: 93 of the original's 97 REST tools; 60 read, 33 write)
- [x] 2.1 products (3 read, 6 write)
- [x] 2.2 store (6 read)
- [x] 2.3 categories (4 read, 4 write) — the recursive tree is returned flattened, capped at 500 nodes
- [x] 2.4 customers (4 read, 3 write) — no password parameter
- [x] 2.5 orders (5 read, 4 write) — `get_order_statuses` removed after the live run (D15)
- [x] 2.6 invoices, shipments, credit memos (6 read, 4 write) — refund amounts sent inside `arguments`
- [x] 2.7 stock (5 read, 1 write) — `lowStock` called with its documented parameters
- [x] 2.8 carts (4 read) — `get_shipping_methods` and `get_payment_methods` deliberately not ported (D13)
- [x] 2.9 CMS (4 read, 6 write)
- [x] 2.10 attributes (5 read, 1 write)
- [x] 2.11 media (2 read, 3 write)
- [x] 2.12 promotions (4 read, 1 write) — the unused `is_active` coupon filter dropped
- [x] 2.13 tax (3 read); URL rewrites removed after the live run (404 on core)
- [x] 2.14 analytics (5 read) — bounded, UTC, real currency, with coverage (D13)

## Phase 2b — Startup budget (done)
- [x] 2b.1 Measure: 95 tools cost ~16 ms to construct; `magento-rest` ~72 ms vs ~54 ms for its siblings
- [x] 2b.2 `describeConformance({ startupCpuBudget: { ms, reason } })`, default 75, ceiling 200, reason in the title (D14)
- [x] 2b.3 `magento-rest` declares 100 with its derivation; 4 of 4 runs of the package suite pass

## Phase 3 — Verification against a live instance
- [x] 3.1 Read tools against a local 2.4.8-p5: 33 verified (D15, first run)
- [x] 3.2 Read tools that return customer data (the operator confirmed test data)
- [x] 3.4 Write tools on disposable entities, orders and restored records: categories, products, stock, media, CMS, customer update, order actions, invoices, shipments, credit memos (D15, second run) — 84 of 93 verified
- [ ] 3.3 Still unverified (7): `add_attribute_option`, `delete_coupon`, and the tools that had no record to read (`get_sales_rule_by_id`, `get_coupon_by_id`, `get_sales_rules`, `search_coupons`, `get_tax_rules`)
- [x] 3.5 Verify `create_customer` and `delete_customer` against the test store (2026-10-27) — 86 of 93 verified

## Phase 4 — Deferred
- [ ] 4.1 MySQL access (D8): promote the SQL guard to `mcp-core`; read-only user and session; timeout; bundle prototype
