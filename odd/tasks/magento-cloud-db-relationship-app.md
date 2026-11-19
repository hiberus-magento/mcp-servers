# magento-cloud: database relationship and app selection

## Objective

Let `magentocloud_query_database` (both `size` and `select`) and the operator CLI `db:sql` path target a specific database relationship (`--relationship`) and application (`--app`).

## Problem

Environments with more than one database relationship (for example `database` and `database-slave`) make the `magento-cloud` CLI prompt interactively for which one to use. The MCP server has no TTY, so the call fails. Multi-app projects have the same issue with `--app`. Today `dbSqlSpec`/`dbSizeSpec` only pass `--project`, `--environment` (and `--raw`/format flags).

## Why

Querying a read replica (`database-slave`) is also the safer default for diagnostics: it keeps load off the primary.

## Scope

- Optional `relationship` and `app` inputs on `magentocloud_query_database`, forwarded to both `db:size` and `db:sql`.
- Strict validation (`^[a-z][a-z0-9_-]*$`-style; never starting with `-`), passed as separate argv tokens.
- Clear, actionable error when the CLI fails because a relationship/app choice is required.
- Operator CLI `db:sql` path gets matching `--relationship` / `--app` flags.
- Specs and package README/CHANGELOG updated.

## Constraints

- Strict TDD (AGENTS.md); synthetic identifiers only.
- Guard (`guardQuery`) placement inside `dbSqlSpec` transform unchanged.
- Only `mcp-core/src/exec/**` calls `execFile`.

## Tasks

- [x] T1 — Add `relationship`/`app` to `db:sql` and `db:size` specs, tool schema, CLI path, error mapping, tests, docs. Route: delegated (writer trigger: 3+ non-trivial files).

## Acceptance criteria

- Tool calls with `relationship: "database-slave"` produce argv containing `--relationship database-slave` for both kinds.
- Invalid names (leading `-`, spaces, uppercase/special chars) are rejected before any process spawns.
- Omitting both keeps argv byte-identical to today.
- Full verification suite from AGENTS.md passes.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify:package`, `node scripts/gen-readme.mjs --check`, `node scripts/check-licenses.mjs`, `node scripts/audit-synthetic-identifiers.mjs`.

## Progress

- Branch `feat/magento-cloud-db-relationship-app` created from `main` (36ef221).
- T1 implemented (delegated writer, uncommitted):
  - Specs: `db:size`/`db:sql` accept optional `relationship` (`^[a-z0-9][a-z0-9_-]*(\.[0-9]+)?$`) and `app` (`^[a-z0-9][a-z0-9_-]*$`), max 64; forwarded as separate `--relationship`/`--app` tokens before `--raw`/`--format=tsv`; guardQuery stays in the dbSqlSpec transform and carries the fields through.
  - Tool: top-level `relationship`/`app` on `magentocloud_query_database` (both kinds), sharing the client schemas; description recommends `database-slave` for diagnostics.
  - Error hint: `describeDbTargetSelectionFailure` (classify.ts) maps the real CLI 1.47.0 refusals ("More than one relationship found." + offered names, "Relationship not found:", "Specifying the --app is required") to a remedy naming the input and listing offered names (only those matching the relationship shape). No extra CLI call; `getRawRelationshipsText` untouched.
  - Operator CLI `db:sql` gets `--relationship`/`--app` with the same validation and flag-named hint.
  - RED observed: commands.test.ts (4 forwarding tests, unrecognized keys), classify.test.ts (7, not a function), magento-cloud-tools.test.ts (5, ZodError unrecognized keys / missing hint / description), cli.test.ts (6, flags ignored -> spawned). GREEN: magento-cloud 437 tests + typecheck tests pass.
  - Checks: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0, `pnpm build` 0, `pnpm verify:package` 0, `gen-readme --check` PASS, `check-licenses` PASS, `audit-synthetic-identifiers` PASS.
  - Docs: three openspec specs (new requirement + scenarios each), package README, changeset `.changeset/magento-cloud-db-relationship-app.md` (minor; CHANGELOG is changeset-generated).

- T1 committed as c9003bb. Parent spot check: magento-cloud 437 tests pass; audit-synthetic-identifiers PASS.
- RDD: assessed high (`high_risk`); consent granted; 4-lens review approved and acknowledged (lineage review-9dc08c1d049f5659). Non-blocking follow-ups: R4 hint drops original stderr (WARNING), R3 CLI usage message changed (WARNING), plus 6 suggestions (classify depends on commands, duplicated hint mapping, unbounded offered-names scan, unanchored marker match, CLI app/not-found hint untested end-to-end).

## Next step

Optional follow-up on the two WARNING findings; push/PR is the user's decision.
