# Tasks: magento-cloud-package — `hiberus-magento-cloud` CLI and `hiberus-magento-cloud-mcp` server

> Size note: exceeds the skill's usual 530-word budget for the same reason
> `design.md`'s own preamble states — six separately-decided areas (the
> `mcp-core` field, binary/failure classification, allowlist+TSV, the
> `db:sql` guard, credential stripping, testing-without-a-CLI) each under
> Strict TDD, and every requirement/scenario across all four delta specs
> maps to at least one task below. Density over prose; each task 1-2 lines,
> path-first, mirroring `openspec/changes/archive/2026-09-17-aco-package/tasks.md`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 6000-10000+ (new package, ~35 client/adapter/test/fixture files, mcp-core's 3-line change, docs) |
| 400-line budget risk | High |
| Chained PRs recommended | No — delivery strategy is `exception-ok`; maintainer accepted `size:exception` |
| Suggested split | Single PR (size exception) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (informational only — not a chaining proposal)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `mcp-core` env field (Phase 0) — load-bearing, everything depends on it | single PR | `pnpm --filter @hiberus-magento/mcp-core test` | Real-process sentinel test (0.6/0.7), no CLI needed | Revert one commit; `env: {}` restored exactly |
| 2 | Scaffold + fake-bin + binary resolution + classification (Phases 1-2) | single PR | `pnpm --filter @hiberus-magento/magento-cloud test locate-binary classify` | Fake binary under `test/fake-bin/` | `packages/magento-cloud` is new; delete the package |
| 3 | Allowlist, TSV, child-env, db:sql guard, parsers (Phases 3-6) | single PR | `pnpm --filter @hiberus-magento/magento-cloud test client` | Mocked `child_process` + fake-bin real-process tier | Same — no external dependents |
| 4 | CLI + MCP tools + conformance + packaging (Phases 7-9) | single PR | `pnpm --filter @hiberus-magento/magento-cloud test` | `node packages/magento-cloud/dist/mcp.js` (manual stdio probe) + `describeConformance` | Same |
| 5 | Registration, docs, closing audits (Phase 10) | single PR | `pnpm audit-synthetic-identifiers && pnpm scan-secrets` | N/A — doc/registration-only | Revert `servers.json`/`README.md`/docs commit |

## Phase 0: `mcp-core` — the `env` field (blocks everything; Decision 1)

- [ ] 0.1 RED `packages/mcp-core/src/exec/exec.test-d.ts` (create): `@ts-expect-error` on `env: process.env` and on `env: { ...process.env }` assigned to `CommandSpec.env`; run under `vitest --typecheck`.
- [ ] 0.2 GREEN `packages/mcp-core/src/exec/command-spec.ts`: add `readonly env?: Readonly<Record<string, string>>;` (+1 line), satisfying 0.1's compile-error assertions.
- [ ] 0.3 RED `packages/mcp-core/src/exec/exec.test.ts`: no-`env` spec's captured `execFile` options `env` is exactly `{}`; an `env: { EXAMPLE_VAR: "value" }` spec's captured `env` is exactly that object, not a superset.
- [ ] 0.4 GREEN `packages/mcp-core/src/exec/run-allowlisted.ts`: narrow `AllowlistedExecOptions.env` to required `Readonly<Record<string, string>>`; change `env: {}` to `env: { ...spec.env }`.
- [ ] 0.5 Run `pnpm --filter @hiberus-magento/mcp-core test`; confirm every pre-existing `exec.test.ts`/`run-allowlisted.timeout.test.ts` case passes unchanged (Success Criteria: no existing caller changes behaviour).
- [ ] 0.6 RED `packages/mcp-core/src/exec/run-allowlisted.env.test.ts` (create): parent sets `MC_SENTINEL_<rand>`; spawn a trivial sentinel-printing script via `runAllowlisted` for a spec with `env` and one with none; assert the sentinel is absent from captured stdout in BOTH.
- [ ] 0.7 Positive control, same file: spawn the identical script via plain `execFile` with NO `env` option; assert the sentinel IS visible — proves 0.6 measures something, per the four-disconnected-mechanisms rule.
- [ ] 0.8 RED, source scan (extend `purity.test.ts`'s helper — read-only precedent `packages/aco/src/client/purity.test.ts`): `run-allowlisted.ts`, comments stripped, contains no `process.env` token; prove the scanner's regex against a synthetic violating string FIRST.
- [ ] 0.9 GREEN: confirm 0.4 leaves no `...process.env` in any form; 0.8 asserts it.
- [ ] 0.10 Options-readback test in `exec.test.ts`: `Object.keys(options.env)` empty for no-`env`; exact key-set deep-equal for an `env`-carrying spec.
- [ ] 0.11 Note (no code change): do NOT add a new eslint `no-restricted-syntax` block for `process.env` under `packages/mcp-core/src/exec/**` — that glob's existing array (`eslint.config.js:200-227`) would be silently overwritten by flat config's last-match-wins merge, deleting the regex/prefix/substring bans. 0.8's source-scan test is the enforcement mechanism, not eslint.

## Phase 1: Scaffold + fixture corpus + fake binary (Decision 8 — unblocks every real-process test below)

- [ ] 1.1 Run `pnpm new-server magento-cloud` scaffolding `packages/magento-cloud/` from `templates/server/`; verify `package.json`, `tsconfig.json`, `tsup.config.ts`, `src/server.ts`.
- [ ] 1.2 Remove the template placeholder tool + test; drop `private` in `packages/magento-cloud/package.json`.
- [ ] 1.3 Add `magento-cloud` to `testing.projects` in `openspec/config.yaml`.
- [ ] 1.4 Create `packages/magento-cloud/test/fake-bin/magento-cloud` (executable Node script, mode `100755`): matches joined argv → fixture file; unknown argv exits 2 with argv echoed on stderr; special argv `__env-probe`/`__slow`/`__flood`.
- [ ] 1.5 RED test: `statSync(fakeBin).mode & 0o111` is non-zero — a mode-bit loss fails loudly rather than turning every real-process test into an unread `ENOENT`.
- [ ] 1.6 RED test: unknown argv against the fake exits `2` with the argv echoed on stderr — proves the fake cannot silently return empty on drift.
- [ ] 1.7 Create `packages/magento-cloud/test/fake-bin/fixtures/*.txt`: canned TSV per read-only subcommand and canned error text; one fixture with an embedded tab and one with an embedded newline in a quoted field; one `environment:relationships` fixture whose service entry carries a synthetic username and password. This is the single corpus both the fake binary and the mocked unit tests below import.
- [ ] 1.8 Document, as a task not a comment: what the fake CAN prove (argv building, env assembly, real spawn/pipe/timeout/byte-cap kills, fd-1 isolation) and CANNOT prove (that the real CLI accepts this argv or still emits this shape) — feeds Phase 10's onboarding doc.

## Phase 2: Binary resolution & three-way failure classification (Decision 2 — ENOENT must be caught before spawning)

- [ ] 2.1 RED `packages/magento-cloud/src/client/locate-binary.test.ts`: `locateBinary({ pathEntries })` returns none when no candidate passes `accessSync(p, X_OK)`.
- [ ] 2.2 GREEN `client/locate-binary.ts`: walks an injected `pathEntries: readonly string[]` (never `process.env.PATH`); returns the absolute path or none.
- [ ] 2.3 RED same file, real-process case: `pathEntries` pointed at Phase 1's fake-bin directory resolves the fake binary's absolute path.
- [ ] 2.4 RED `client/errors.test.ts` + `classify.test.ts`: proves `run-allowlisted.ts:43`'s `typeof error.code === "number" ? error.code : 1` ENOENT trap is unreachable — with no binary resolved, `MagentoCloudNotInstalledError` is thrown and `execFile`/`runAllowlisted` is never called.
- [ ] 2.5 GREEN `client/errors.ts`: `MagentoCloudNotInstalledError`, `MagentoCloudNotAuthenticatedError`, `MagentoCloudUnsupportedVersionError`, each naming the binary/env var/version.
- [ ] 2.6 RED `classify.test.ts`: exit + the fixture's (1.7) non-interactive auth-help stderr text classifies `not-authenticated`, distinct from a generic failure.
- [ ] 2.7 GREEN `client/classify.ts`: classification over exit code + stderr text for the three known shapes, default generic-but-named otherwise.
- [ ] 2.8 RED: `--version` parsed once per process, memoized; an unparseable version does NOT fail — records `version: "unknown"`, proceeds.
- [ ] 2.9 GREEN: version parsing + memoization in `classify.ts`; `MINIMUM_SUPPORTED_CLI_VERSION` marked PROVISIONAL, check warn-only (never blocking).
- [ ] 2.10 Apply-time: run `magento-cloud --version` against the real installed CLI; record the actual value in `classify.ts`'s comment, confirming/correcting exploration's indicative `5.3.1`; never block apply on this.

## Phase 3: Allowlist + TSV parsing (Decision 3, 4 — before anything consumes them)

- [ ] 3.1 RED `client/commands.test-d.ts` (create): `Extract<ReadOnlyKey, ForbiddenKey>` is `never` for the two `as const` literals.
- [ ] 3.2 GREEN `client/commands.ts`: `READ_ONLY_SUBCOMMANDS` (the 17 entries) and `FORBIDDEN_SUBCOMMANDS` (`ssh`, `environment:ssh`, `environment:scp`, `environment:drush`, five `tunnel:*`, `db:dump`, `api:curl`/`project:curl`/`organization:curl`/`environment:curl`, plus other named mutating forms) as `as const` literals.
- [ ] 3.3 RED `commands.test.ts`: `createMagentoCloudAllowlist(...).listCommandKeys()` deep-equals `READ_ONLY_SUBCOMMANDS` mapped to full keys, sorted.
- [ ] 3.4 RED same file, one test per forbidden entry: `allowlist.resolve(bin, tokens)` is `undefined` for every forbidden entry, explicitly including `ssh`, every `tunnel:*` form, `db:dump`, and all four `*:curl` passthroughs.
- [ ] 3.5 RED same file, POSITIVE CONTROL: `checkReadOnlyIsolation({ registeredCommandKeys: [...real, "<bin> db:dump"], expectedCommandKeys })` returns exactly one violation — proves the checker detects contamination, not a no-op.
- [ ] 3.6 GREEN: implement `createMagentoCloudAllowlist()` and `checkReadOnlyIsolation()` in `commands.ts`.
- [ ] 3.7 RED `tsv.test.ts`: a naive `split("\t")` control produces the WRONG row count against the embedded-tab fixture (1.7) — shown explicitly as the wrong approach.
- [ ] 3.8 RED same file: the real parser round-trips the embedded-tab fixture (one field, correct column count) and the embedded-newline fixture (value spans the newline, no extra row); rows keyed by the header the CLI emits, never positional index; a missing `REQUIRED_HEADERS` entry throws `MagentoCloudOutputShapeError` naming the subcommand, missing header, and headers seen.
- [ ] 3.9 GREEN `client/tsv.ts`: ~50-line quote-aware character state machine (RFC4180 semantics, `\t` delimiter); `MagentoCloudOutputShapeError` in `errors.ts`.
- [ ] 3.10 RED per argv builder: every list-/table-shaped subcommand's built argv contains `--format=tsv`; none contains `--format=table`/`csv`/`plain` or no `--format`.
- [ ] 3.11 GREEN: wire `--format=tsv` into every list-shaped `buildArgv`.

## Phase 4: Child-environment assembly + credential provider (domain side of Decision 1; Decision 2's `stdio` guarantee)

- [ ] 4.1 RED `client/child-env.test.ts`: `buildChildEnv({ token, home, path })`'s key set deep-equals exactly `["HOME","MAGENTO_CLOUD_CLI_TOKEN","PATH"]` — never a spread, never `process.env` read directly.
- [ ] 4.2 GREEN `client/child-env.ts`: named-keys-only construction.
- [ ] 4.3 RED `credential-provider.test.ts` (mirrors `packages/eds/src/credential-provider.ts`, read-only precedent): missing `MAGENTO_CLOUD_CLI_TOKEN` (env and file both absent) throws `MissingCredentialError` naming the variable, BEFORE `locateBinary`/`execFile` runs.
- [ ] 4.4 GREEN: wire `resolveCredentialValue({ domain: "magento-cloud", envVar: "MAGENTO_CLOUD_CLI_TOKEN" })` from `mcp-core`.
- [ ] 4.5 RED: every spawn's captured spawn options have `stdio: "pipe"`, never `"inherit"`.
- [ ] 4.6 GREEN: confirm the domain always calls `mcp-core`'s unmodified `runAllowlisted` — no package-local spawn wrapper, per design's rejected alternative.

## Phase 5: `db:sql` hardening — one lexer, four rules (Decision 5 — before the tool that exposes it)

- [ ] 5.1 RED `client/sql/lex.test.ts`: strips `'…'`/`"…"`/`` `…` `` (with `\'`/`''`), `-- `/`#` line comments, `/*…*/` blocks; tracks paren depth; one fixture per case proving the stripped form.
- [ ] 5.2 GREEN `client/sql/lex.ts`: the lexer producing the form every rule reads.
- [ ] 5.3 RED `guard.test.ts` Rule 1 positive: single `SELECT ... LIMIT 10` accepted.
- [ ] 5.4 RED Rule 1 negative: `UPDATE`/`DELETE`/`INSERT`/`DROP` each rejected by leading-verb, `execFile` never called.
- [ ] 5.5 RED Rule 1 negative: two `;`-separated statements (first valid `SELECT`) rejected, `execFile` never called.
- [ ] 5.6 RED Rule 2: `SELECT *` and `SELECT DISTINCT *` rejected before any spawn.
- [ ] 5.7 RED Rule 2 evasions (proves the rule is not a projection regex): `t.*`, `SeLeCt *`, `/*c*/SELECT *`, and `SELECT id FROM (SELECT t.* FROM big t) x` each rejected.
- [ ] 5.8 RED Rule 2 ACCEPTED COST, recorded as a decision: `SELECT a * b` is rejected too, message names both exits (name the columns, or use `COUNT(*)`); separate test proves `SELECT COUNT(*) FROM t` IS accepted.
- [ ] 5.9 GREEN Rule 2: reject any `*` in the statement that is not the sole argument of `COUNT(`, over the lexed form.
- [ ] 5.10 RED Rule 3, one test per form: `INTO OUTFILE`, `INTO DUMPFILE`, `LOAD_FILE(` each independently rejected.
- [ ] 5.11 GREEN Rule 3.
- [ ] 5.12 RED Rule 4: no-`LIMIT` `SELECT` reaches `execFile` with an injected `LIMIT <rowCap>` in the CAPTURED ARGV; explicit `LIMIT` above `rowCap` rejected (not clamped), cap named in message; a subquery's `LIMIT` is not mistaken for the statement's (depth-0 tracking); `SHOW`/`DESCRIBE`/`EXPLAIN` take no injected `LIMIT`.
- [ ] 5.13 GREEN Rule 4 + `GuardedQuery` brand: `guardQuery()` wired as the `db:sql` spec's `argsSchema.strict().transform()`.
- [ ] 5.14 RED: a `*` inside a string literal (`WHERE name = '*'`) is allowed — the residual, correctly not a projection.
- [ ] 5.15 RED, the coupling test the design calls out explicitly: for the `db:sql` spec specifically, `buildArgv` is never called when `argsSchema.safeParse` fails — proving no unguarded query can reach `execFile` through this spec (reuses `exec.test.ts:137`'s guarantee, in-domain).
- [ ] 5.16 RED `maxOutputBytes` independence: a query within `LIMIT` but exceeding `maxOutputBytes` classifies output-cap, not row-cap (fake-bin's `__flood`).
- [ ] 5.17 GREEN: wire `maxOutputBytes` from `CommandSpec`, unchanged.
- [ ] 5.18 Choose `ROW_CAP` and `maxOutputBytes` for the `db:sql` spec in `commands.ts`, each with a stated rationale (e.g. ROW_CAP against a diagnostic query's reviewable size, `maxOutputBytes` against MCP frame/memory bounds) — not a round number; document chosen-not-documented, mirroring `packages/aco/src/client/rate-limiter.ts`'s pace constants (read-only precedent).

## Phase 6: Parsers, credential stripping, timeout/output-cap disambiguation (Decision 4, 6, 7)

- [ ] 6.1 RED `client/parsers/*.test.ts` per subcommand: each declares its own `REQUIRED_HEADERS`; row mapper output keyed by header name.
- [ ] 6.2 GREEN: implement each `client/parsers/*.ts` over `tsv.ts`.
- [ ] 6.3 RED `client/relationships.test.ts`: fixture (1.7) carries `username`/`password`; the built `ServiceEndpoint` contains ONLY `host`/`port`/`scheme`/`service`.
- [ ] 6.4 RED same file: `client/index.ts` exports no type carrying `username`/`password`; source-scan asserts no `{ ...raw }` in `relationships.ts`.
- [ ] 6.5 RED same file, strongest proof (on SERIALIZED output, same fixture the fake binary emits): `JSON.stringify(serviceEndpointsResult)` contains neither the fixture's username nor password value, and no `/user|pass|secret|token/i`-matching key.
- [ ] 6.6 GREEN `client/relationships.ts`: `ServiceEndpoint` (4 fields) built field-by-field from named keys; `getRawRelationshipsText(): CliOnlyText` opaque branded escape hatch.
- [ ] 6.7 RED source-scan: no file under `src/tools/**` references `getRawRelationshipsText` (passes vacuously until Phase 8's `tools/` tree exists — re-run at 8.10).
- [ ] 6.8 RED `classify.test.ts`, two tests differing ONLY in which limit the fake exceeds: `__flood` → `output-cap-exceeded`; `__slow` → `timed-out`.
- [ ] 6.9 RED same file, ambiguous case: both conditions true → `resource-limit-exceeded` naming both causes/remedies; no signal → `killed-unclassified` naming both, stating the cause could not be attributed.
- [ ] 6.10 GREEN `classify.ts`: `elapsedMs`/`atByteCap`/`atTimeBudget` per design's formulas; `TIME_ATTRIBUTION_FACTOR = 0.9` documented chosen, not derived.

## Phase 7: CLI adapter (`hiberus-magento-cloud`)

- [ ] 7.1 RED `packages/magento-cloud/src/cli.test.ts`: a token as a flag/positional argument is rejected before persisting; instructs stdin instead.
- [ ] 7.2 RED same file: `echo "$TOKEN" | hiberus-magento-cloud auth token set` reads stdin, persists at `$XDG_CONFIG_HOME/hiberus/magento-cloud.json` mode `0600`.
- [ ] 7.3 GREEN `cli.ts`: stdin-only token intake; `resolveCredentialValue` precedence (env over file).
- [ ] 7.4 RED: `auth status` output never contains the token value under any outcome.
- [ ] 7.5 GREEN: wire `auth status` to `auth:info --no-auto-login`, redacted via `mcp-core`'s `redact()`.
- [ ] 7.6 RED: the CLI's own unstripped `environment:relationships` command may include the fixture's username/password — deliberately CLI-only.
- [ ] 7.7 GREEN: wire the raw relationships CLI command via `getRawRelationshipsText()`.
- [ ] 7.8 RED: exit code non-zero on a rejected argument, missing credential, each CLI-failure classification, and a `db:sql` guard rejection.
- [ ] 7.9 GREEN: wire exit codes through `cli.ts` error handling.
- [ ] 7.10 RED (threat matrix, untrusted upstream text): stderr with `;`, backticks, an ANSI escape, and a token-shaped value round-trips inert and is redacted on the CLI path.
- [ ] 7.11 GREEN: apply `redact()` on the CLI stderr-rendering path.

## Phase 8: MCP tools & server (`hiberus-magento-cloud-mcp`) — depends on Phases 3-6

- [ ] 8.1 RED `packages/magento-cloud/src/tools/magento-cloud-tools.test.ts`: registered tool names deep-equal the eight declared names, `toHaveLength(8)`.
- [ ] 8.2 GREEN: eight `defineTool()` registrations, `.strict()` zod inputs — every inbound guard lives in the schema.
- [ ] 8.3 RED `mcp.test-d.ts`: `magentocloud_query_database`'s `request` is `{kind:"size"}` | `{kind:"select", query, maxRows?}`; a free-form `mode` call site fails to compile; an omitted-`query` `"select"` call site fails to compile.
- [ ] 8.4 GREEN: discriminated zod schema, `query` required on `select`, no `includeSize` boolean.
- [ ] 8.5 RED runtime: `{kind:"select"}` with no `query` rejected before any spawn.
- [ ] 8.6 RED runtime: `{kind:"size"}` wraps `db:size`, issues no `db:sql` invocation.
- [ ] 8.7 GREEN: wire both branches through Phase 5's guard.
- [ ] 8.8 RED `magentocloud_get_environment_config` with `include:["serviceEndpoints"]` against the credential-carrying fixture: result contains no username-/password-shaped field.
- [ ] 8.9 GREEN: wire the handler through 6.6's stripped `ServiceEndpoint`.
- [ ] 8.10 Re-run 6.7's client-boundary scan now that `src/tools/**` exists; confirm zero references to `getRawRelationshipsText`.
- [ ] 8.11 RED: with no token resolvable, EVERY tool call returns `isError:true` immediately, naming `hiberus-magento-cloud auth token set`, no hang.
- [ ] 8.12 GREEN: confirm `defineTool.invoke`'s existing `MissingCredentialError` catch needs no change (read-only precedent `packages/mcp-core/src/tools/define-tool.ts`).
- [ ] 8.13 RED: `not-installed`/`not-authenticated`/`unsupported-version` each surface as a pairwise-distinguishable `isError:true` result naming its own remedy.
- [ ] 8.14 GREEN: wire `classify.ts`'s three error types into the tool-result error path.
- [ ] 8.15 RED: all eight tools annotated `readOnlyHint:true`/`destructiveHint:false`/`idempotentHint:true`; each description states WHEN to use it.
- [ ] 8.16 GREEN: set annotations + write the eight descriptions.
- [ ] 8.17 Implement `packages/magento-cloud/src/mcp.ts`: `createStdioServer()`, unconditional `server.connect(transport)` at module top level (kept out of `magento-cloud-tools.ts`, mirrors `aco`'s split).

## Phase 9: Conformance & packaging gate (Decision 9 — first real caller; after tools exist)

- [ ] 9.1 RED `packages/magento-cloud/src/mcp.conformance.test.ts`: at module scope, prepend Phase 1's fake-bin directory to this file's own `process.env.PATH` before `describeConformance(...)` runs (`sanitizedEnv()` forwards ONLY `PATH` — `jsonrpc-client.ts:44-50`); restore in a file-level `afterAll`.
- [ ] 9.2 GREEN: `pnpm --filter @hiberus-magento/magento-cloud build`; wire `describeConformance` WITH `shellOutProbe` targeting `magentocloud_auth_status` and `readOnlyIntrospections` fed from `createMagentoCloudAllowlist(...).listCommandKeys()`.
- [ ] 9.3 RED: the probe's `expectedResultText` equals the exact text Phase 1's canned `auth:info` fixture produces.
- [ ] 9.4 Confirm no cross-file leakage of 9.1's `PATH` mutation under the repo's vitest pool config — run the full suite twice, inspect for order-dependent failures elsewhere; record the finding in the file's header.
- [ ] 9.5 RED: `tools/list` on the BUILT bundle returns exactly the eight declared names (deep-equal, sorted).
- [ ] 9.6 GREEN: satisfied once 8.2 ships in the built bundle; test confirms.
- [ ] 9.7 RED `scripts/verify-bundle.mjs` (read-only) against `packages/magento-cloud`'s dist: ≤2 MB single file, none of `express`/`hono`/`cors`/`jose`/`ajv`, tarball `dependencies:{}`, shebang, `LICENSE`; tarball contains no `test/` entry (the fake binary must never publish).
- [ ] 9.8 GREEN: fix `tsup.config.ts`/`package.json` until the gate passes.
- [ ] 9.9 RED `client/purity.test.ts` (mirrors `packages/aco/src/client/purity.test.ts`, read-only precedent): no `console.`/`process.exit`/`process.env`/prompt/ANSI under `client/`; each regex proven against a synthetic violation first.
- [ ] 9.10 RED `packages/magento-cloud/eslint-fixtures/deep-client-import.ts` (create): deliberately imports a deep `client/` path; assert `no-restricted-imports` fires with the exact rule id.
- [ ] 9.11 GREEN: confirm no production eslint change is needed — the boundary rule already covers `packages/**/src/**`.

## Phase 10: Registration, docs, closing audits (last)

- [ ] 10.1 Add `SYNTHETIC_MC_PROJECT_ID`, `SYNTHETIC_MC_ENVIRONMENT_IDS`, `SYNTHETIC_MC_TOKEN`, `SYNTHETIC_MC_HOST` to `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` (additive only).
- [ ] 10.2 Re-derive every fixture value used across Phases 1-9 from 10.1's constants.
- [ ] 10.3 Add the `magento-cloud` entry to `servers.json`: eight tools, `status:"planned"`, `requires.binaries:["magento-cloud","hiberus-magento-cloud"]`, `docs:"docs/magento-cloud-onboarding.md"`.
- [ ] 10.4 Run `scripts/gen-readme.mjs` (read-only); commit only its output — never hand-edit `README.md`.
- [ ] 10.5 Create `docs/magento-cloud-onboarding.md` (follows `docs/aco-onboarding.md`/`docs/eds-onboarding.md`, read-only precedent): token creation, CLI install, the fixture re-capture procedure (recording CLI version + date), and the manual acceptance checklist run once by a human against the real CLI before publish — named as a human gate, not a test.
- [ ] 10.6 In the same doc, record the real `magento-cloud --version` output from 2.10, confirming/correcting the provisional `5.3.1` finding.
- [ ] 10.7 Flip `servers.json`'s `magento-cloud` entry `status` to `"alpha"` in the final commit, after every prior gate is green.
- [ ] 10.8 In `proposal.md`'s Risks table, drop the "checked-in `exploration.md` is the superseded REST-only pass" row — it is stale; `exploration.md` opens "SECOND PASS" and is already authoritative. Do not act on it otherwise.
- [ ] 10.9 Run `node scripts/audit-synthetic-identifiers.mjs` — passes; confirm the `.cloud`-hostname allowlist (`magento.cloud`, `api.magento.cloud`, `auth.magento.cloud`, `ssh.api.magento.cloud`) covers every vendor hostname used, and no OTHER `.magento.cloud` subdomain appears anywhere in the diff.
- [ ] 10.10 Run `node scripts/scan-secrets.mjs` — passes; prove it can fail first (stage a synthetic credential-shaped literal, confirm FAIL, remove, rerun clean).
- [ ] 10.11 Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` from a clean state with `packages/magento-cloud` included — all green; confirm `packages/mcp-core`'s diff touches only `command-spec.ts`/`run-allowlisted.ts`/their tests.
