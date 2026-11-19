# Pre-publish hardening of magento-graphql and magento-rest

Objective: fix the defects the pre-publish review found so `@hiberus-magento/magento-graphql` and `@hiberus-magento/magento-rest` can be published to npm (with patch releases of the siblings that share the CLI defect).
Branch: `fix/pre-publish-hardening` (from origin/main 8229610). Delivery: one PR, commits per work unit. Runner: vitest via `pnpm test` (per package `pnpm --filter <pkg> test`).

## Specs

- S1 — CLI entrypoint: every package CLI (`aco`, `aem-sites`, `eds`, `magento-cloud`, `magento-graphql`, `magento-rest`) must run `main()` when started through an npm/npx bin symlink (`node_modules/.bin/<bin>`), not only when `dist/cli.js` is run directly. Today `auth status` through the symlink prints nothing and exits 0. One shared helper in `mcp-core`, a test that runs through a real symlink.
- S2 — magento-rest SQL guard: `??` (mysql2 identifier placeholder) is refused for reads and writes; the sensitive-table denylist also matches prefixed table names (Magento `db.table_prefix`) and adds `tfa_user_config`, `session`, `authorization_rule`, `authorization_role`; credential-named identifiers cannot be referenced in a query (closes alias/expression/WHERE-oracle leaks); locking reads after `OFFSET` (`FOR SHARE`/`FOR UPDATE`) are refused.
- S3 — magento-rest row redaction uses the original column name (mysql2 `orgName`), so `password_hash AS ph` stays redacted, and a `core_config_data.value` column is redacted when its `path` is secret or not visible in the result.
- S4 — magento-graphql: a response with `errors` whose requested top-level field(s) are all `null` is a classified error (authorization remedy text included), not a partial-data success. Partial data with at least one non-null field keeps today's `{data, errors}` shape. Error messages are kept as an array without re-splitting on `" | "`.
- S5 — HTTP timeout: each Magento REST and GraphQL attempt is aborted after a bounded timeout and reported as a transport error saying it timed out; writes/mutations stay non-retried.
- S6 — Docs and manifest match the code: `db_query` description and README on `LIMIT`; `servers.json`/README "additive only" fields file (it accepts `remove`); magento-graphql "never handles passwords" (it does with writes enabled); `resendConfirmationEmail` not idempotent.
- S7 — Release: a changeset for the first release of `@hiberus-magento/magento-graphql` and patch changesets for packages whose CLI is fixed (S1) or behavior changed.

Out of scope (follow-ups): cancellation pass-through of the MCP request signal; `/rest/all/V1` store scoping; revenue status default; SKU with `/` behind Apache; GitHub setting "Allow GitHub Actions to create and approve pull requests" (repository admin, user action).

## Tasks

- T1 [S1] CLI entrypoint helper + all CLIs — inline (parent) — status: done (RED: module missing → GREEN 4/4; 6 CLIs wired) — 890d774
- T2 [S2,S3,S6-db] magento-rest SQL guard and redaction — delegated (parallel unit, writer reason: parallelism) — status: done (correction: execute() + quoting/star/TABLE + alias pairing; recheck B1/B2 fixed, S1 direct fixed, wrapped forms documented) b5988c5 (RED: 23+5+1 failing → GREEN 960/960 rest)
- T3 [S4,S5-graphql,S6-graphql] magento-graphql error semantics + timeout — delegated (parallel unit, writer reason: parallelism) — status: done (RED: 11 failing for intended reasons → GREEN 268/268; typecheck+lint 0; generated file 1-line hand edit, no introspection committed) — f4dcba1
- T4 [S5-rest] magento-rest HTTP timeout — inline (parent) — status: done (RED: 3 tests hang → GREEN 24/24, +stalled-body case) — d39ef58
- T5 [S6-manifest,S7] servers.json, README regen, changesets — inline (parent, shared files) — status: done (servers.json db_query/fields/passwords, READMEs regenerated, 3 changesets)

## Log

- L1 (2026-11-19, user): "Se han publicado y mergeado nuevas PRs, necesito que revises su correcta implementacion sobre todo el mcp de magento-graphql y magento-rest, que son las que queremos utilizar para un proyecto que hace uso de MCPs sobre instancias de Magento, y nos faltaba esta pieza. Tambien nos faltará publicar todos los paquetes en NPM una vez estén validados y en correcto funcionamiento."
- L2 (2026-11-19): review on origin/main 8229610 — all 10 AGENTS.md gates green; tarball MCP smoke OK (rest 60 tools, graphql 57). Blockers confirmed: CLI symlink no-op (reproduced), `??` guard bypass (read in code), graphql null+errors as success. Release workflow fails creating the Version Packages PR (repository setting).
- L3 (2026-11-19, user): "si, adelante." — authorizes the fix branch above.
- L4 (2026-11-19): all 9 AGENTS.md gates green on the branch (tests: rest 960, graphql 268, mcp-core 98, others unchanged). Packed tarballs: `hiberus-magento-graphql auth status` and `hiberus-magento-rest auth status` now answer through `node_modules/.bin`. Writer finding: mysql2's formatter also replaces `??` inside double quotes, so `??` is refused on the raw text. Open, documented: expressions over `core_config_data.value` are not redacted (database grants are the boundary). Independent verifier on S2/S3 running; native review due (risk high, item 2).
- L5 (2026-11-19): native review (risk/resilience/reliability) closed escalated on one informational finding (rest transport message reworded) — reverted in ff72c21. Independent verifier on S2/S3 (real MySQL 8.0 / MariaDB 10.6): BROKEN — B1 `'` inside `"..."` desyncs guard vs mysql2 client formatter, `?` value runs as SQL (read and write admin_user); B2 `SELECT ALL *`/`DISTINCTROW *` + positional UNION returns rp_token/password_hash; S1 self-join of core_config_data clears another row's secret value. T2 reopened: correction batch = server-side prepared statements (execute), refuse `"` and `\` in literals, star allowlist, pair config value by alias.
- L6 (2026-11-19): correction batch landed (rest 990 tests; all 9 gates green). Verifier recheck on real MySQL 8.0 / MariaDB 10.6: B1 fixed (double quotes/backslashes refused; execute() keeps `?` in literals literal), B2 fixed (modifier star, `TABLE`, positional UNION refused), S1 fixed for direct self-joins; a derived table or UNION around the self-join still hides the origin — same class as the documented `CONCAT(value)` limit, pre-existing. Per the one-correction bound, not re-opened: comment and README now scope the rule to direct references and name derived tables/UNION as a limit; database grants are the boundary.
