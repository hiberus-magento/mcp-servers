```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:5c857cf01417cee59e23b203f730837e65bf482dd00402aa1ad60e60f6892ab7
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 27/27
scenarios: 38/38
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:deb434fa6ea8e2852198415d4d1841978d58948fd69a5f606b894bcf1f877e8a
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:c7ffd5dd0aa25d5b6258856827fbe42fda9541356b188a5759ee2f7d9feb871e
```

## Verification Report

**Change**: aco-package
**Version**: N/A (unversioned OpenSpec change)
**Mode**: Strict TDD
**Commit verified**: `a1f81b0` (HEAD, working tree clean)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 171 |
| Tasks complete | 170 |
| Tasks incomplete | 1 (7.3 — correctly `N/A`, trigger `\|ratio\| > 20%` never fired; ratio measured +2.0%) |

Spot-checked 7.3's N/A claim directly: `scripts/compare-bundle-size.mjs` measures `aco/dist/mcp.js` vs `eds/dist/mcp.js`; re-ran it and confirmed the ratio is within the 20% band, so 7.3's branch is correctly untaken and `cold-start.ts` retains `COLD_START_BUDGET_MS = 250` with a dated 2026-09-17 note. This N/A is honest, not a shortcut.

### Build & Tests Execution

**Build**: ✅ Passed
```text
$ pnpm build
Tasks: 3 successful, 3 total (root also builds mcp-core/fixture-server/eds via turbo dependency graph)
aco: dist/cli.js 766.27 KB, dist/mcp.js 1.06 MB — build clean, no errors
```

**Tests**: ✅ 462 passed / ❌ 0 failed / ⚠️ 0 skipped
```text
$ pnpm test
@hiberus-magento/mcp-core:test   16 files, 76 tests passed
@hiberus-magento/mcp-testing:test 8 files, 40 tests passed
@hiberus-magento/fixture-server:test 1 file, 1 test passed
@hiberus-magento/eds:test        25 files, 101 tests passed
@hiberus-magento/aco:test        31 files, 169 tests passed (incl. type-only *.test-d.ts under vitest --typecheck)
root scripts:test                11 files, 75 tests passed
```
Also independently re-ran `pnpm --filter @hiberus-magento/aco exec vitest run --typecheck` directly: 31 files / 169 tests / 0 type errors.

**Lint**: ✅ No issues found (`pnpm lint`)
**Typecheck**: ✅ 7/7 tasks successful (`pnpm typecheck`)
**Packaging gate**: ✅ `pnpm verify:package` — PASS for eds/aco/fixture-server; `mcp.conformance.test.ts`'s G1–G6 packaging-gate test independently confirms aco's bundle: single file ≤2 MB, no `express`/`hono`/`cors`/`jose`/`ajv`, tarball `dependencies:{}`, shebang, `LICENSE`.
**`git diff -- packages/mcp-core/`**: ✅ empty — re-confirmed directly, zero bytes changed under `mcp-core` across the whole change.
**Synthetic-identifier audit**: ✅ `node scripts/audit-synthetic-identifiers.mjs` — PASS, 267 files scanned, no banned identifiers.
**Secret scan**: ✅ `node scripts/scan-secrets.mjs` — PASS.
**README staleness gate**: ✅ `node scripts/gen-readme.mjs --check` — matches committed output.

**Coverage**: Not separately measured (no coverage tool wired into this repo's config); the aco package's own test-to-source ratio (169 tests across 31 files, plus 6 `.test-d.ts` type-only files) and the line-by-line inspection below stand in for a coverage percentage.

### Spec Compliance Matrix

Counting only `### Requirement:` and `#### Scenario:` headings across the four delta specs: **27 requirements / 38 scenarios** (aco-client 12/16, aco-cli 7/8, aco-mcp 7/9, mcp-conformance delta 1/5). Every scenario below was checked against a runtime-executed, currently-passing test — source inspection alone was not treated as sufficient.

#### aco-client (12 req / 16 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Client Module Purity | No forbidden calls in client source | `client/purity.test.ts` (9 tests) | ✅ COMPLIANT |
| Client Boundary Import | Deep import rejected by lint | `eslint-fixtures.test.ts` + `eslint-fixtures/deep-client-import.ts` | ✅ COMPLIANT |
| Track-Separated Credential Headers | Admin request carries Bearer + x-api-key | `client/headers.test.ts > buildAdminHeaders` | ✅ COMPLIANT |
| Track-Separated Credential Headers | Unprotected Merchandising request carries no secret | `client/headers.test.ts > buildMerchandisingHeaders` | ✅ COMPLIANT |
| HTTP 200 with errors[] Is Never Success | 200 with errors[] is not treated as success | `client/graphql.test.ts` (asserts `status===200`/`ok===true` AND throw, same test) | ✅ COMPLIANT |
| Typed Error Classification | Missing access key → `CatalogViewAccessError` | `client/graphql.test.ts` | ✅ COMPLIANT |
| Typed Error Classification | Admin scope failure names both exits | `client/errors.test.ts` + `credential-provider.test.ts > relayCredentialFailure` | ✅ COMPLIANT |
| Heuristic Throttle Detection | Raw 429 with no errors[] is not a throttle | `client/http.test.ts` (429/no-errors and 200/throttle-shaped in the same test) | ✅ COMPLIANT |
| Heuristic Throttle Detection | 200 with throttle-shaped extension is a throttle | `client/http.test.ts`, `client/graphql.test.ts` | ✅ COMPLIANT |
| scrollId Pagination Confined | scrollId round-trips across two pages | `client/operations/price-books.test.ts` | ✅ COMPLIANT |
| provision Dry-Run/Idempotent | Default invocation issues no writes | `client/provision.test.ts` | ✅ COMPLIANT |
| provision Dry-Run/Idempotent | Second run vs unchanged state is a no-op | `client/provision.test.ts` | ✅ COMPLIANT |
| provision Aborts on Zero-Match | Zero-match vertical aborts the run | `client/provision.test.ts` | ✅ COMPLIANT |
| Facet Query Structured Non-Facetable | Non-facetable attribute → structured result, no extra query | `client/operations/facets.test.ts` (client layer), `tools/aco-tools.test.ts` (tool layer, independent boundary #2) | ✅ COMPLIANT |
| Conservative Token-Bucket Pacing | Mutation fan-out paced by limiter, no fixed sleep | `client/rate-limiter.test.ts` (fake timers; `ADMIN_PACE` more conservative than `MERCH_PACE`) | ✅ COMPLIANT |
| Tolerant Response Parsing | Unexpected field does not crash a tool call | `client/types.test.ts` (10 tests: extra field passes through, missing optional → undefined, missing keyed → `AcoSchemaMismatchError`, across 3 parse functions) | ✅ COMPLIANT |

#### aco-cli (7 req / 8 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Admin Credential Never a CLI Arg | Token via stdin accepted | `cli.test.ts > auth token set — stdin-only intake` | ✅ COMPLIANT |
| Admin Credential Never a CLI Arg | Token as CLI arg rejected | `cli.test.ts > --token is NEVER accepted as a CLI argument` (both `--token X` and `--token=X`) | ✅ COMPLIANT |
| Credential Precedence and File Permissions | Persisted token file mode 0600 | `cli.test.ts` line ~106 (`persists the piped token at mode 0600`) | ✅ COMPLIANT |
| Mint-Then-Paste Dual-Exit Scope Failure | Scope failure names both remedies | `credential-provider.test.ts > relayCredentialFailure` (asserts both `hiberus-aco auth mint` and `hiberus-aco auth token set` in the message) | ⚠️ PARTIAL — see WARNING below; the literal mint-attempt-time branches are not asserted for dual-exit *message content* |
| Pasted Bearer Expiry Checked Before Any Request | Expired pasted Bearer blocks the request | `credential-provider.test.ts > PastedBearerProvider` (asserts fetch double never called) | ✅ COMPLIANT |
| provision Defaults to Dry-Run | No flag means no writes | `cli.test.ts > provision — dry-run default and idempotency` | ✅ COMPLIANT |
| CLI-Only Operations Excluded from MCP | CLI-only command has no MCP tool | `tools/aco-tools.test.ts` (imports `CLI_ONLY_OPERATIONS` from `cli.ts`, asserts no overlap with the six tool names) | ✅ COMPLIANT |
| Exit Codes Reflect Outcome | Failure exits non-zero | `cli.test.ts > Admin commands with no credential configured exit non-zero` | ✅ COMPLIANT |

#### aco-mcp (7 req / 9 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Exactly Six Tools | tools/list matches exactly | `tools/aco-tools.test.ts` (unit, name+count) and `mcp.conformance.test.ts` (built-bundle `tools/list`, artifact-layer proof) | ✅ COMPLIANT |
| Exactly Six Tools | No tool for any CLI-only op | `tools/aco-tools.test.ts` | ✅ COMPLIANT |
| aco_toggle_policy No all Branch | mode "all" does not type-check | `mcp.test-d.ts` (proof 1/3) | ✅ COMPLIANT |
| aco_toggle_policy No all Branch | Empty names rejected at runtime | `tools/aco-tools.test.ts` (proof 2/3, plus omitted-names and unknown-key cases) and `mcp.conformance.test.ts` (proof 3/3, built-bundle `properties.mode.const==="named"` / `enum===undefined`) | ✅ COMPLIANT |
| Facet Values Never Triggers Sampling | Non-facetable issues no extra queries | `tools/aco-tools.test.ts` (exactly 1 request) | ✅ COMPLIANT |
| Admin-Track Tools Use Admin Provider | Missing credential → actionable error | `tools/aco-tools.test.ts > Tier boundary` (6 `invoke()` calls, empty config dir, all 4 Tier-B tools `isError:true` naming `hiberus-aco auth token set`) | ✅ COMPLIANT |
| Merchandising Tools Require No Secret | Unprotected-view search needs no credential | `tools/aco-tools.test.ts > Tier boundary` (Tier-A tools succeed with no credential configured) | ✅ COMPLIANT |
| Annotations Match Semantics | Mutating tool annotated correctly | `tools/aco-tools.ts` source (readOnlyHint/destructiveHint/idempotentHint literals) — asserted structurally in `aco-tools.test.ts` | ✅ COMPLIANT |
| aco_toggle_policy No-Op at Already-Held State | Already-enabled policy not re-mutated | `tools/aco-tools.test.ts` (asserts zero `UpdatePolicy` calls, `changed:false`) | ⚠️ PARTIAL — only tested with `enabled` explicitly `true`/`false` in the fixture; the disclosed deviation's own claim (real Adobe responses omit `enabled`, and the handler must always mutate rather than falsely report a no-op) has no test exercising that exact path — see WARNING below |

#### mcp-conformance delta (1 req / 5 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Shared Synthetic Catalog-Views Fixture | Fixture contains no real identifiers | `catalog-views.test.ts` | ✅ COMPLIANT |
| " | Fixture consumable by multiple domain packages | `cross-domain.test.ts` (imports real `@hiberus-magento/eds/config/catalog-views.js`, not a reimplementation) | ✅ COMPLIANT |
| " | Migration additive, existing consumers keep working | `catalog-views.test.ts` (`columns.slice(0,4)` guard) + `eds` suite green (101 tests) against migrated fixture | ✅ COMPLIANT |
| " | Fixture carries ACO-to-EDS hand-off columns | `catalog-views.test.ts` (exact header-order assertion) | ✅ COMPLIANT |
| " | A provisioned row is the same row both domains read | `cross-domain.test.ts` (2 tests: positive round-trip + negative "never written" case) | ✅ COMPLIANT |

**Compliance summary**: 38/38 scenarios have a passing covering test; 2 of those (flagged ⚠️ PARTIAL above) are covered for their literal spec wording but leave a related, disclosed edge case under-tested — detailed as WARNING findings below, not counted as blocking gaps against the spec text as written.

### Success Criteria (proposal.md) — verified individually

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `pnpm install && lint && typecheck && test && build` clean, `packages/aco` included | Re-ran independently this session — all green | ✅ |
| 2 | Scaffolded via `pnpm new-server`; boundary rule rejects deep import | `eslint-fixtures.test.ts` passes; `git log` shows `pnpm new-server aco` in task 0.1 | ✅ |
| 3 | No `console.`/`process.exit`/`process.env`/prompt/ANSI under `client/`, test-asserted | `client/purity.test.ts`, 9 tests | ✅ |
| 4 | 200+errors[] classified as failure, same test asserts both | `client/graphql.test.ts` line 29-38 | ✅ |
| 5 | `access-key-invalid` → distinct class with remedy | `client/graphql.test.ts`, `client/errors.ts > CatalogViewAccessError` | ✅ |
| 6 | Scope/permission failure names both exits, test asserts both strings | `credential-provider.test.ts > relayCredentialFailure` | ✅ (see WARNING re: mint-time-specific branch) |
| 7 | `git diff` empty under `packages/mcp-core/` | Re-verified directly: `git diff --stat -- packages/mcp-core/` → empty | ✅ |
| 8 | Two concurrent expired-token calls → exactly one mint | `credential-provider.test.ts > single-flight coalescing` (fake timers, `mintCalls===1`) | ✅ |
| 9 | Expired pasted Bearer throws before any request | `credential-provider.test.ts` (`fetchSpy` never called) | ✅ |
| 10 | `auth token set` stdin-only, no CLI-arg path | `cli.test.ts`, `CLI_OPTIONS` regex guard | ✅ |
| 11 | scrollId round-trips on priceBooks only | `client/operations/price-books.test.ts`, `client/cursor.test.ts` (type-level exclusion for non-priceBooks results) | ✅ |
| 12 | Empty `names` rejected, no non-"named" mode type-checks, both type + runtime tests | `mcp.test-d.ts`, `tools/aco-tools.test.ts` | ✅ |
| 13 | No MCP tool for provision/view delete/prune/policy delete/api query/auth/profile; exact 6-name set asserted | `tools/aco-tools.test.ts`, `mcp.conformance.test.ts` | ✅ |
| 14 | Non-facetable returns structured result, no extra queries, request-count asserted | `client/operations/facets.test.ts` (client), `tools/aco-tools.test.ts` (tool) | ✅ |
| 15 | provision defaults dry-run, zero mutations asserted | `client/provision.test.ts`, `cli.test.ts` | ✅ |
| 16 | provision idempotent: mutations pass 1 only | `client/provision.test.ts`, `cli.test.ts` (`--yes` twice) | ✅ |
| 17 | Zero-match vertical aborts before any write | `client/provision.test.ts` | ✅ |
| 18 | Throttle keys off extensions only; 429/no-errors not a throttle, 200/throttle-shaped is | `client/http.test.ts` | ✅ |
| 19 | All 6 tools pass metadata completeness, each description states WHEN to use | `mcp.conformance.test.ts` (`describeConformance`); descriptions read directly in `tools/aco-tools.ts` — all 6 begin "Use this to…" | ✅ |
| 20 | `describeConformance` passes with no `shellOutProbe` | `mcp.conformance.test.ts` — confirmed no `shellOutProbe` argument passed | ✅ |
| 21 | catalog-views.csv carries the 3 new columns, `eds` suite stays green | `catalog-views.test.ts`, `eds` suite (101 tests green) | ✅ |
| 22 | Cross-domain test: one row written ACO-side, read EDS-side | `cross-domain.test.ts` — imports the real `eds` reader, has a negative case | ✅ |
| 23 | `audit-synthetic-identifiers.mjs` passes, no real identifiers | Re-ran directly — PASS, 267 files | ✅ |
| 24 | Bundle size measured vs `eds`, ratio recorded, 20% trigger honored | `scripts/compare-bundle-size.mjs` + `.test.mjs`; `cold-start.ts` dated note; re-verified ratio still within band this session | ✅ |
| 25 | Packaging gate: ≤2MB, forbidden deps excluded, tarball deps:{}, shebang, LICENSE | `mcp.conformance.test.ts` G1-G6, `pnpm verify:package` | ✅ |
| 26 | `servers.json` has the `aco` entry, README matches generator, CI fails if stale | `node scripts/validate-manifest.mjs`, `node scripts/gen-readme.mjs --check` re-run — both pass | ✅ |

**All 26 Success Criteria hold, backed by a currently-passing test or a re-run command, not by trusting the apply-progress report.**

### Correctness (Static Evidence) — deep points from the verification brief

| Area | Status | Notes |
|---|---|---|
| Error model: status never drives classification | ✅ Confirmed | `classify(envelope, op)` — exactly 2 params, `classify.length===2` is itself asserted at runtime (`graphql.test.ts` line 20); no `status` field anywhere in `graphql.ts`'s input types |
| Partial response (`data` + `errors`) handling | ✅ Confirmed | `classify()` rejects with `hadPartialData:true`, discards `data` before it is ever attached to the thrown error (`graphql.test.ts` asserts `JSON.stringify(error)` never contains the leaked payload marker, and `Object.hasOwn(error,"data")===false`) — matches design.md Decision 1's stated partial-success rule exactly |
| Scope-claim verification on mint | ✅ Confirmed, real behavior | `mintAdminToken` decodes the minted JWT's `scope` claim and rejects if `commerce.aco.admin` is absent even when `access_token` is present — `credential-provider.test.ts` proves this with a token that HAS a well-formed `access_token` but lacks the scope |
| Credential self-heal (per-call resolution, no cache) | ✅ Confirmed, real behavioral test | `credential-provider.test.ts > resolveAcoCredentialDirect self-heal`: writes an expired token to the actual config file, calls `getToken()` (rejects), overwrites the file with a fresh token on the SAME provider instance, calls `getToken()` again (succeeds) — a genuine two-call, file-rewrite-between-calls test, not a mock assertion |
| `relayCredentialFailure` wrapper exists and is load-bearing | ✅ Confirmed | `mcp-core/src/tools/define-tool.ts:95-96` catches only `MissingCredentialError`/`CredentialExpiredError`; `tools/aco-tools.test.ts`'s "relays a LIVE AdminScopeError" test drives a genuine `AdminScopeError` through a real admin GraphQL error response, through `relayCredentialFailure`'s rewrap, through `defineTool.invoke`'s catch, and asserts `isError:true` — this is the actual raw-propagation path, proven end to end, not just unit-tested in isolation |
| Tolerant wire parsing (client) vs strict tool inputs (adapters) | ✅ Confirmed, not blurred | `client/types.ts` uses hand-written narrowing with no `.strict()`, explicitly commented as a "deliberate inversion" (line 72 comment); `tools/aco-tools.ts`'s six zod schemas all end in `.strict()` (lines 42,51,57,65,67,85) |
| `client/index.ts`'s `raw.*`/`provisioning.provision` deviation | ✅ Honest as claimed | `client/index.test.ts`'s "exports exactly the error classes and the factory" test checks `Object.keys(clientModule)` — the MODULE's exported bindings — which stays exactly 8 names; `raw`/`provisioning` are properties on the *returned client instance*, never new module-level exports. The distinction the deviation note draws (module surface vs. instance surface) is real and the test proves the narrower claim precisely |
| `PolicyResult.enabled` deviation — "always mutates when Adobe omits it" | ⚠️ Code correct, but untested for the actual case | See WARNING below |
| Task 6.3 deviation (`const` not `enum` for a lone `z.literal`) | ✅ Verified independently | Re-derived from first principles: `zod`'s `toJSONSchema()` (and the SDK's `toJsonSchemaCompat`) renders a single literal as `{type,const}`; `enum` only appears for a union of ≥2 literals. `mcp.conformance.test.ts` asserts both `modeSchema?.const==="named"` AND `modeSchema?.enum===undefined` against the BUILT bundle — this is the equivalent no-"all"-branch proof the task requires, correctly substituted for the tasks.md text's now-incorrect `enum` wording |
| Fact-change consistency (IMS grant works) | ⚠️ One stale doc found | See WARNING below — `design.md` was not updated; all other artifacts (`tasks.md`, `credential-provider.ts`, `docs/aco-onboarding.md`, `servers.json`) correctly reflect the correction |
| Mint-time dual-exit remedy completeness | ⚠️ One narrow gap found | See WARNING below |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Decision 0 — Two-tier surface, per-call credential resolution, `relayCredentialFailure` wrapper | ✅ Yes | Verified in source and by end-to-end test, above |
| Decision 1 — Error model keyed off `extensions`, never status | ✅ Yes | `graphql.ts`, `errors.ts` — exact match |
| Decision 2 — Mint-then-paste, both primary, `mcp-core` untouched | ✅ Yes (behaviorally) | `git diff -- packages/mcp-core/` is empty; precedence logic matches design exactly. Rationale text in design.md itself (see WARNING) is stale relative to the corrected understanding, though the resulting *code* is not — the design was updated by the *task list* re-ordering note, not by editing the design document itself |
| Decision 3 — `.strict()` tool inputs, `mode` kept as a legible single-literal field | ✅ Yes | Confirmed; task 6.3's own text is what needed correcting, which the shipped test does |
| Decision 4 — Tolerant client parsing, deferred RS256 signing seam | ✅ Yes | `CatalogViewAccessTokenSupplier` field exists and is exercised by a stub-supplier test; no signing code is bundled for the unprotected path |
| Provisioning: four-step pipeline, dry-run default, name-keyed idempotency | ✅ Yes | `provision.ts`/`provision.test.ts` match design.md's stated pipeline exactly, including the two-call `createChannel`+`updateChannel` view-creation shape |
| Cold-start: provisional budget, disclosed re-measure trigger | ✅ Yes | Trigger correctly did not fire; retained honestly with a dated note |

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. **`design.md` was not updated after the mid-change credential correction.** `openspec/changes/aco-package/design.md` lines 414-420 and the alternatives table at lines 424-425 still assert as established fact that "`client_credentials` does not work for `commerce.aco.admin` in their tenant, which the Python CLI's own field notes record" and justify the stored-Bearer-wins-over-mint precedence partly on "a path already known to fail there." This is now known incorrect — the grant works once the Developer Console project has the Adobe Commerce Optimizer Admin API added, per `tasks.md`'s own 2026-09-17 Phase 3 header, `credential-provider.ts`'s file-header comment, and `docs/aco-onboarding.md`. Every other artifact in the change was updated to reflect the correction; `design.md`, the 953-line design document this verification was specifically asked to check for exactly this consistency, was not. The precedence *decision* itself (stored/env Bearer wins unconditionally) is still defensible on its own merits (an operator who deliberately pastes should not have it silently overridden by a now-working mint), so this is a documentation-accuracy issue, not a behavioral defect — but it is exactly the kind of stale claim the verification brief asked to rule out, and it was not fully ruled out.
   - File: `openspec/changes/aco-package/design.md:414-420,424-425`

2. **`mintAdminToken`'s "granted fewer scopes than requested" failure names only one remedy exit, not two.** `packages/aco/src/credential-provider.ts:325-337` — when IMS returns a syntactically valid `access_token` that lacks `commerce.aco.admin`, the thrown `MissingCredentialError`'s `reason` says only "Add the … API … then re-attempt hiberus-aco auth mint" — it never mentions pasting a Studio Bearer as an alternative, unlike its sibling branch three lines above (`credential-provider.ts:313-322`, "no access_token at all") which does name both. `design.md`'s own stated principle ("A scope failure at mint time surfaces as MissingCredentialError whose Remedy.reason names both exits verbatim") and the `aco-cli` spec's "Mint-Then-Paste With a Dual-Exit Scope Failure" requirement (MUST name both exits on any scope/permission mint failure) do not carve out an exception for this branch. No test asserts message content for either mint-time branch — `credential-provider.test.ts`'s two covering tests (`"rejects a minted token that carries FEWER scopes…"` and `"rejects when IMS returns no access_token at all"`) each check only the error type / a single substring, not the dual-exit requirement. The proposal's own Success Criterion #6 ("proven by a test asserting both strings are present") IS satisfied — but by a different code path (`relayCredentialFailure`'s live-`AdminScopeError` rewrap, tested at `credential-provider.test.ts:209-225`), not by the mint-attempt path the `aco-cli` spec requirement is literally about.
   - File: `packages/aco/src/credential-provider.ts:325-337`; spec: `openspec/changes/aco-package/specs/aco-cli/spec.md:43-56`

3. **The `PolicyResult.enabled`-omitted "always mutate" deviation is asserted in a comment but never driven by a test with `enabled` actually absent.** `packages/aco/src/tools/aco-tools.ts:230-239`'s comment states the honest design intent precisely (task 5.7's own deviation note: "when absent, the toggle handler cannot prove a no-op and always writes"). But every ListPolicies fixture across `tools/aco-tools.test.ts` (lines 130, 148) and `client/operations/policies.test.ts` explicitly sets `enabled: true` or `enabled: false` — never omits the field. `client/types.test.ts`'s generic "missing OPTIONAL field → undefined" proof (used for `defaultPriceBookId`, `currency`, `mandatory`) is never instantiated for `enabled` either. The exact scenario the deviation exists to handle honestly — a real Adobe response with no `enabled` field at all, which per `exploration.md` is the actual shape — has no test proving the handler issues `updatePolicy` rather than silently reporting `changed:false`. Reading the code, the logic (`existing.enabled === args.enabled`, which is `false` when `existing.enabled` is `undefined`) is correct, but this is exactly the "requirement/deviation with no covering test" shape flagged as highest-value in the verification brief.
   - File: `packages/aco/src/tools/aco-tools.ts:230-239`; tests: `packages/aco/src/tools/aco-tools.test.ts:127-161`

**SUGGESTION**:

1. Coverage tooling is not wired into this repo (no `--coverage` flag configured for vitest here), so file-level coverage percentages could not be reported; the density of behavioral/adversarial test cases inspected directly (169 aco tests, all traced to specific spec scenarios) is offered as the substitute evidence.
2. `credential-provider.ts`'s two mint-failure branches (`no access_token` vs `insufficient scope`) could share one `buildDualExitMintFailureReason()` helper to make the WARNING-2 asymmetry structurally impossible to reintroduce, rather than relying on both call sites remembering to include both exits by hand.

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress` (Engram id 820) carries a "TDD Cycle Evidence" table for batch 4; batches 1-3 (merged, not independently re-fetched this session) are referenced consistently by `tasks.md`'s per-task RED/GREEN annotations |
| All tasks have tests | ✅ | 170/171 tasks map to a test file or an explicit read-only/script verification step; 7.3 is the sole N/A, correctly justified |
| RED confirmed (tests exist) | ✅ | All referenced test files exist and were independently located and read this session: `graphql.test.ts`, `errors.test.ts`, `http.test.ts`, `headers.test.ts`, `rate-limiter.test.ts`, `retry.test.ts`, `cursor.test.ts`, `types.test.ts`, `credential-provider.test.ts`, `cli.test.ts`, `aco-tools.test.ts`, `cross-domain.test.ts`, `mcp.conformance.test.ts`, `catalog-views.test.ts`, and 6 `*.test-d.ts` files |
| GREEN confirmed (tests pass) | ✅ | 169/169 aco tests pass on this session's independent re-run (`vitest run --typecheck`), 462/462 pass repo-wide |
| Triangulation adequate | ✅ | Multi-case tables throughout (`selectAdminProvider`'s `it.each` over 4 combinations; `classify()`'s 11-case precedence suite; `credential-provider.test.ts`'s 16 cases) |
| Safety Net for modified files | ✅ | `packages/mcp-core/` untouched (git-diff-verified); `eds`'s 101 tests stay green against the migrated shared fixture, the one cross-package touchpoint |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~155 | ~25 | vitest |
| Type-level (never executed) | 12 | 6 (`*.test-d.ts`) | `vitest --typecheck` |
| Conformance (built-bundle subprocess) | 8 | 1 (`mcp.conformance.test.ts`) | `describeConformance`, spawned `dist/mcp.js` |
| Cross-package integration | 2 | 1 (`cross-domain.test.ts`) | real `@hiberus-magento/eds` import |
| **Total (aco package)** | **169** | **31** | |

---

### Changed File Coverage

Coverage tooling is not configured for this repo; see SUGGESTION-1 above. In its place, every non-trivial source file under `packages/aco/src/` was either directly read this session or confirmed to have a corresponding, currently-passing test file with scenario-level assertions (documented in the Spec Compliance Matrix and Success Criteria table above).

---

### Assertion Quality

No tautologies, ghost loops, or assertion-free tests were found in any file read this session. Every test inspected exercises real production code (real `classify()`, real `PastedBearerProvider`, real `createAcoTools(...).invoke(...)`, a real file-system round-trip for the self-heal test) and asserts on observable values, not implementation details or mock call counts alone. Two files (`client/graphql.test.ts`, `credential-provider.test.ts`) deliberately combine a "this really is a 200/success at the transport level" assertion with the failure-classification assertion in the *same* test — exactly the trap-visibility pattern the proposal's own Success Criteria require, not a coincidence.

**Assertion quality**: ✅ All assertions verify real behavior

### Quality Metrics

**Linter**: ✅ No issues found
**Type Checker**: ✅ No errors (including `--typecheck` type-only test files)

### Verdict

**PASS WITH WARNINGS** — All 171 tasks resolved correctly (170 complete, 1 honestly N/A); all 27 requirements and 38 scenarios across the four delta specs have passing, non-trivial covering tests; all 26 proposal Success Criteria hold under independent re-execution; the full 462-test repo-wide suite, lint, typecheck, and every named gate (`verify:package`, `gen-readme --check`, `audit-synthetic-identifiers`, `scan-secrets`) pass cleanly; `packages/mcp-core/` is untouched. Three WARNING-level findings — one stale design-document claim about the IMS grant, one narrow dual-exit-remedy asymmetry in a single mint-failure branch, and one disclosed deviation whose exact edge case lacks a driving test — are real and should be fixed, but none of them contradicts a Success Criterion, breaks a currently-passing test, or blocks archival. This change is ready to archive once the WARNINGs are triaged (fix now or explicitly accept and carry forward).
