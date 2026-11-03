# Tasks: aem-sites-cloud-config

## Phase 1: Guard and client

- [x] 1.1 `cq:conf` in `BUILTIN_PAGE_PROPERTIES` and `PAGE_FIELDS`; `assertPropertyValue` accepts only a plain `/conf/...` path (properties.test.ts).
- [x] 1.2 `confExists` reads `<conf>.json`, 404 → false.

## Phase 2: Plan

- [x] 2.1 `page.set-properties` with `cq:conf`: `not-found` for a missing node, `CONF_WARNING` when it changes (plan-apply.test.ts).

## Phase 3: Docs

- [x] 3.1 Spec `aem-sites-mcp` (Cloud Configuration), package README.

## Phase 4: Live validation

- [x] 4.1 On a non-production author: set `cq:conf` on a recreated store, read it back, publish a page below it.
  - 2026-10-29, a non-production author: before, every publish below three recreated store pages answered 400 (no permissions on an unrelated site). `page.set-properties` with `cq:conf` (existing `/conf/<site>/<store>` nodes) applied 200 on each, `aem_get_page` reads it back, and the following publishes below them answered 200 and reached the expected Edge Delivery Services site.
