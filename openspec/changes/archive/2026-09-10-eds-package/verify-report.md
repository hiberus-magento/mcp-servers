```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:af9c05e8ce8e2956a88d9de172e6408b67bc1943cd37e2e5f4821c3a6c83b3d3
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 25/25
scenarios: 36/36
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:1ecf57d6e927dd277dc5a2fa2eb139ba3ef736ca2656427a30d3e0c7964f89a7
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:0e52d5e9a3900f2a362a788d2c380ac27cccde938e19270c2e5ea90290a04d93
```

## Verification Report

**Change**: eds-package
**Version**: N/A (first version of `packages/eds`)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 12 phases, ~140 line items (1.1–12.7 + disclosed additions 7.18, 7.19, 9.6, 9.7) |
| Tasks complete | All checked `[x]` in `tasks.md`; spot-checked against real source and passing tests |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Build**: ✅ Passed (re-run independently: `pnpm build`, exit 0, both `dist/cli.js`/`dist/mcp.js` and `dist/server.js` produced)

**Tests**: ✅ 278 passed / 0 failed / 0 skipped (re-run independently)
```text
$ pnpm test
mcp-core:test   — 16 files, 76 tests passed
fixture-server:test — 1 file, 1 test passed
mcp-testing:test — 8 files, 37 tests passed
eds:test        — 24 files, 98 tests passed
root vitest     — 10 files, 66 tests passed
Total: 59 test files, 278 tests, 0 failures
```

**Lint**: ✅ `pnpm lint` — "ESLint: No issues found"
**Typecheck**: ✅ `pnpm typecheck` — no errors, all 4 packages
**Packaging gate**: ✅ `pnpm verify:package` — both single-bin (`fixture-server`) and two-bin (`eds`: `cli.js`+`mcp.js`, 1,837,720 bytes) PASS under the corrected G1/G5 gate
**Synthetic-identifier audit**: ✅ `node scripts/audit-synthetic-identifiers.mjs` — 185 files scanned, PASS
**Secret scan**: ✅ `node scripts/scan-secrets.mjs` — PASS

All six commands above were re-executed directly in this verify pass (not taken on the apply report's word), independent of the orchestrator's own prior run, and all six confirm the claims made.

### Adversarial Checks Performed (this verify pass)

| Check | Method | Result |
|---|---|---|
| Throttle-branch swap in `http.ts` | Mutated `status === 429` → `status === 999`, re-ran `http.test.ts` | Exactly 2 tests failed (`propagates AdminRateLimitError...on 429` and the discriminant test), file restored via `git status`-confirmed clean diff |
| `eds_reindex` gate | Read `mcp.test.ts`'s 6 direct `edsReindexInput`/`nonEmptyPaths` probes | All 6 genuinely distinct assertions hold (accept-both, reject-discriminant-alone, reject-`false`, reject-stray-field-on-paths-branch, reject-empty-paths-on-paths-branch, accept-paths-happy-path). One narrower gap noted below (SUGGESTION). |
| Two-binary packaging | Inspected `scripts/verify-bundle.mjs`'s `gateG1SingleBundle`/`resolveBinPaths`, `packages/eds/package.json`'s `bin` map | G1 correctly asserts "one bundle per declared bin, no stray files" rather than "exactly one .js total"; matches design.md's correction |
| Cold-start assertion has teeth | Read `cold-start.test.ts`'s `slow-cold-start-subject.fixture.mjs` proof and `describeConformance`'s wiring | Assertion genuinely fires against a slow subject; median-of-5 mechanism is real, not decorative |
| `mcp-conformance` shellOutProbe not weakened | Read `conformance.ts`'s `if (options.shellOutProbe)` guard and `stdout-purity.test.ts`'s standing contaminating-exec-subject test | The guarded `it()` body is byte-identical to its prior unconditional form; a second, independent test (not gated on any package under test) proves `checkStdoutPurity` still fires on an exec-spawned fd-1 leak |
| Roles enum vs `cli.test.ts` | Cross-checked `CONFIRMED_ROLES` (8 roles) against the test asserting `superuser` rejection | Consistent — no stale test still expects `config_admin` to be rejected |
| Client boundary lint | Read `eslint-fixtures/deep-client-import.ts` + `eslint-fixtures.test.ts` | Fires `no-restricted-imports`, names `client/index` in the message, exactly as the spec requires |
| Template/fixture-server coupling (design Open Question 1) | `rg createStdioServer` across `templates/server/src/server.ts`, `packages/fixture-server/src/server.ts`, `packages/eds/src/mcp.ts` | All three install the guard; Open Question 1 is genuinely resolved, not silently dropped |

### Spec Compliance Matrix — `eds-client` (12 requirements / 15 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Client Module Purity | No forbidden calls in client source | `client/purity.test.ts` — static scan over `client/**` | ✅ COMPLIANT |
| Client Module Purity | Client function returns structured data | `client/purity.test.ts` — `authStatus()` spot check, `typeof result === "object"` | ✅ COMPLIANT |
| Client Boundary Import | Deep import is rejected by lint | `eslint-fixtures.test.ts` — `deep-client-import.ts` flagged, names `client/index` | ✅ COMPLIANT |
| Auth Header Shape | Request carries the auth header | `client/http.test.ts` — asserts `X-Auth-Token` header, `Authorization` absent | ✅ COMPLIANT |
| Admin API Request Pacing | Requests exceeding rate are paced | `client/rate-limiter.test.ts` — 25 requests under `vi.useFakeTimers()`, no >10/window | ✅ COMPLIANT |
| 429-vs-503 Throttle Disambiguation | Raw 429 → Admin API limit | `client/http.test.ts` (`mapThrottle`) | ✅ COMPLIANT |
| 429-vs-503 Throttle Disambiguation | 503+`(429)` → content-source throttle | `client/http.test.ts` (`mapThrottle`) | ✅ COMPLIANT |
| Job Success Is Any 2xx | 202 is treated as success | `client/jobs.test.ts` — `fetchJobEnvelope` against literal 202 fixtures, plus a source-scan test banning `=== 200` | ✅ COMPLIANT |
| Config Write Existence Check via GET-Before-Write | Existing site detected before write | `client/operations/site-config.test.ts` — asserts call order GET-then-PUT, and that a 404-then-PUT-200 case never treats the PUT as the check | ✅ COMPLIANT |
| Explicit JSON Body on Snapshot Writes | Snapshot POST always carries a body | `client/operations/snapshots.test.ts` — with and without caller paths, body non-empty + content-type present | ✅ COMPLIANT |
| Bulk Write Ignored-Path Reporting | Ignored config paths surfaced | `client/operations/live.test.ts` — `/.helix/config` appears in `ignoredPaths` | ✅ COMPLIANT |
| Tolerant Site List Response Shape | Bare array accepted | `client/types.test.ts` — `parseSiteList` on bare array and `{sites:[...]}`, same normalized shape | ✅ COMPLIANT |
| Cursor Pagination via nextToken | nextToken round-trips | `client/cursor.test.ts` — `fetchPage` round-trip + never-auto-drain assertion | ✅ COMPLIANT |
| Domain-Specific Address Shapes | code endpoint owner/repo, snapshot no ref | `client/paths.test.ts` — `codePath`/`snapshotPath`, plus a `@ts-expect-error` on a `ref` field | ✅ COMPLIANT |

**Compliance summary**: 15/15 scenarios compliant.

### Spec Compliance Matrix — `eds-cli` (6 requirements / 8 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Stdin-Only Token Intake | Token piped via stdin accepted | `cli.test.ts` — `setToken` with injected `readStdin`, persists piped value | ✅ COMPLIANT |
| Stdin-Only Token Intake | Token as CLI arg rejected | `cli.test.ts` — `--token abc123` and a bare positional both rejected before persisting | ✅ COMPLIANT |
| Credential Precedence for the eds Domain | `EDS_TOKEN` wins over config file | `credential-provider.test.ts` — both present, env wins | ✅ COMPLIANT |
| Credential Precedence for the eds Domain | Persisted file at mode `0600` | Reused unmodified from `mcp-core`; proven generically at `packages/mcp-core/src/credentials/resolve.test.ts:73` (`fileStat.mode & 0o777 === 0o600`) for `persistCredential`, which `cli.ts:264` calls verbatim as `persist: (token) => persistCredential(EDS_DOMAIN, token)` | ✅ COMPLIANT (via unmodified shared primitive — see SUGGESTION below) |
| Minted Key Is Shown Once and Unrecoverable | Mint output states unrecoverable | `cli.test.ts` — stdout has value alone, stderr has banner/id/roles/expiry, value appears exactly once across both streams | ✅ COMPLIANT |
| Auth Status Never Echoes the Key | Status output contains no key value | `cli.test.ts` — combined stdout+stderr never contains the token | ✅ COMPLIANT |
| CLI-Only Operations Excluded from MCP | CLI-only command has no MCP tool | `mcp.test.ts` — all 13 CLI-only operation slugs checked absent from the 9 registered tool names | ✅ COMPLIANT |
| Exit Codes Reflect Outcome | Failure exits non-zero | `cli.test.ts` (`main` tests) — `process.exitCode` 0 on success, non-zero on missing credential | ✅ COMPLIANT |

**Compliance summary**: 8/8 scenarios compliant.

### Spec Compliance Matrix — `eds-mcp` (5 requirements / 6 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Nine-Tool Task-Shaped Surface | `tools/list` matches surface exactly | `mcp.test.ts` — `createEdsTools()` returns exactly the 9 named tools, `toHaveLength(9)` | ✅ COMPLIANT |
| Annotations Match Declared Semantics | Mutating, non-idempotent tool annotated correctly | `mcp.test.ts` — full annotation table for all 9 tools, including `eds_manage_snapshot` (`false/true/false`) | ✅ COMPLIANT |
| Full-Site Reindex Requires Both Gate Fields | scope alone does not trigger | `mcp.test.ts` — `edsReindexInput.safeParse` rejects discriminant-alone and `confirmFullReindex:false` | ✅ COMPLIANT |
| Full-Site Reindex Requires Both Gate Fields | both fields together reach the branch | `mcp.test.ts` — accepts `{scope:"full-site", confirmFullReindex:true}`; type-level proof in `mcp.test-d.ts` | ✅ COMPLIANT |
| Bulk Write paths Is Non-Empty | Empty paths array is a schema rejection | `mcp.test.ts` — `nonEmptyPaths` rejects `[]` for `eds_get_status_bulk`/`eds_set_live_state`/reindex's paths branch | ✅ COMPLIANT |
| Missing Credential Surfaces as Immediate Actionable Failure | Missing token → actionable error, no hang | `mcp.test.ts` — `isError: true`, text names `hiberus-eds auth token set`, resolves without timing out | ✅ COMPLIANT |

**Compliance summary**: 6/6 scenarios compliant.

### Spec Compliance Matrix — `mcp-conformance` delta (2 requirements / 7 scenarios)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Stdout Purity Assertion | Clean session passes | `conformance.test.ts` (fixture-server) + `mcp.conformance.test.ts` (eds) | ✅ COMPLIANT |
| Stdout Purity Assertion | Stray stdout output fails the suite | `stdout-purity.test.ts` — `inherit-child` positive control, `checkStdoutPurity` fires | ✅ COMPLIANT |
| Stdout Purity Assertion | Domain-independent probe catches contamination with no `shellOutProbe` | `shell-out-probe-optional.test.ts` — `describeConformance` with no `shellOutProbe` against a no-exec-tool subject; fd-1 probe still fires against `no-guard-subject.fixture.mjs` | ✅ COMPLIANT |
| Stdout Purity Assertion | Supplying `shellOutProbe` preserves exec-based coverage unweakened | `conformance.test.ts` (real, `DEFAULT_SHELL_OUT_PROBE`, exec tool) + `stdout-purity.test.ts`'s standing contaminating-exec-subject test | ✅ COMPLIANT |
| Cold-Start Time Budget | Cold start within budget passes | `mcp.conformance.test.ts` — the real `hiberus-eds-mcp` bundle's median (~45-47 ms) is well under 250 ms | ✅ COMPLIANT |
| Cold-Start Time Budget | Cold start exceeding budget fails | `cold-start.test.ts` — `slow-cold-start-subject.fixture.mjs` genuinely trips `checkColdStart` | ✅ COMPLIANT |
| Cold-Start Time Budget | Threshold recorded with its derivation methodology | `cold-start.ts`'s comment block records N (20), discarded count (3), local p50/p95 (45.0/46.6 ms), and the 1.75× multiplier alongside the threshold, and explicitly records that the CI-runner run was NOT PERFORMED rather than omitting that fact | ✅ COMPLIANT (scenario literally requires the numbers be recorded alongside the threshold, which they are — see SHOULD-FIX below on the separate, stricter Requirement-level and proposal-level claim that those numbers originate from a real CI runner) |

**Compliance summary**: 7/7 scenarios compliant at the literal scenario level; one Requirement-level and proposal-level gap noted below (SHOULD-FIX), not captured by any written scenario.

### Correctness (Static Evidence)

| Requirement area | Status | Notes |
|---|---|---|
| `client/` purity (no `console.*`/`process.exit`/`process.env`/prompts/ANSI) | ✅ Implemented | Static scan test, zero violations |
| Adapter boundary (`client/index.ts` only) | ✅ Implemented | Eslint `no-restricted-imports`, proven by fixture |
| Credential precedence + `0600` | ✅ Implemented | `EDS_TOKEN` > file; reuses `mcp-core` verbatim |
| No token as CLI argument | ✅ Implemented | `parseCredentialCliArgs` pre-dispatch + no token parameter in `setToken`'s signature + `CLI_OPTIONS` name-pattern test |
| Missing/expired credential → immediate actionable failure | ✅ Implemented | `MissingCredentialError` path proven for MCP tools; CLI path proven separately |
| Nine-tool surface, descriptions "Use this..." | ✅ Implemented | All 9 descriptions verified to start with "Use this" |
| Two hazard gates as types (`z.discriminatedUnion` under `request`, `nonEmptyPaths`) | ✅ Implemented | Both type-level (`.test-d.ts`) and runtime (`safeParse`) proofs exist |
| Two-binary packaging (`cli.js`+`mcp.js` from one `dist/`) | ✅ Implemented | G1/G5 corrected and re-verified live against eds's real `dist/` |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Decision 1 — domain-independent fd-1 probe, additive, `shellOutProbe` optional | ✅ Yes | Verified structurally unweakened (see adversarial checks) |
| Decision 2 — client module layout, injected deps only | ✅ Yes | `client/index.ts` exact export surface; `testing/fetch-double.ts` kept outside `client/` |
| Decision 3 — two throttle errors, one mapping site (`mapThrottle`) | ✅ Yes | Confirmed by mutation test (see adversarial checks) |
| Decision 4 — `X-Auth-Token` header choice | ✅ Yes | Confirmed in `http.test.ts` |
| Decision 5 — pacing/retry/pagination/job-polling choices | ✅ Yes | Token bucket (not continuous refill, per 3.10's documented pivot), retry gated on `idempotent`, cursor never auto-drains, `waitForJob` polls `links.self` verbatim |
| Decision 6 — auth bootstrap/mint/status | ✅ Yes | Including the disclosed `StaticTokenProvider` catch-and-rethrow wart, mitigated by calling `resolveCredentialValue` directly on the CLI path |
| Decision 7 — nine tools, nested `oneOf` reindex schema | ✅ Yes, with a disclosed narrower evidence base | See SHOULD-FIX on Design Risk 2 below |
| Decision 8 — cold-start methodology | ⚠️ Partially, disclosed | Methodology implemented exactly as specified, but the CI-runner measurement step was never executed (environment limitation) — see SHOULD-FIX |
| Open Question 1 — `createStdioServer()` in template + fixture-server | ✅ Resolved | Both files updated, confirmed by direct `rg` |
| Open Question 2 — nested `oneOf` verified only via hand-rolled client | Disclosed, not silently resolved | See SHOULD-FIX below |
| Open Question 3 — roles enum | ✅ Resolved and closed | 8-role `CONFIRMED_ROLES` matches orchestrator's independent doc verification; no stale test contradicts it |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `tasks.md` documents RED/GREEN pairs for essentially every task, including several genuine (not scripted) RED failures called out explicitly (e.g. 3.10's rate-limiter design pivot, 4.1's `=== 200` bug, 4.11's caught-409 bug, 9.6's `isDirectRun` regression) |
| All tasks have tests | ✅ | 24 test files + 3 `.test-d.ts` files under `packages/eds/src`, 8 test files under `packages/mcp-testing/src/conformance` |
| RED confirmed (tests exist) | ✅ | All referenced test files exist and were read directly in this pass |
| GREEN confirmed (tests pass) | ✅ | 278/278 tests pass on independent re-run |
| Triangulation adequate | ✅ | Throttle disambiguation: 4 assertions across 2 distinct status/header combinations; reindex gate: 6 distinct probes; nonEmptyPaths: exercised across 3 different tools |
| Safety Net for modified files | ✅ | `verify-bundle.mjs`/`turbo.json`/`eslint.config.js` changes are proven not to break `fixture-server` (still 7/7 and 1/1 respectively) |

**TDD Compliance**: 6/6 checks passed

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~270 | ~50 | vitest |
| Integration (real subprocess, real built bundle) | ~20 | `mcp.conformance.test.ts`, `conformance.test.ts`, `stdout-purity.test.ts`, `cold-start.test.ts`, `shell-out-probe-optional.test.ts` | vitest + real `spawn()` |
| E2E | 0 | — | not applicable (no browser/UI surface) |
| **Total** | **278** | **59** | |

### Changed File Coverage

Coverage tooling is not configured in this workspace (`vitest` runs without `--coverage` and no coverage threshold is declared in any package's `vitest.config`). Reported per the strict-TDD module's rule: **"Coverage analysis skipped — no coverage tool detected."** Not a failure — the 278 real, non-trivial, behavior-asserting tests plus the adversarial mutation checks performed in this pass are the primary evidence instead.

### Assertion Quality

Scanned all 24 `packages/eds/src/**/*.test.ts` files plus the 5 amended `packages/mcp-testing/src/conformance/*.test.ts` files for tautologies, ghost loops, smoke-test-only patterns, and mock-heavy tests: zero `vi.mock`/`vi.spyOn` calls anywhere in either package (the design's fetch-double/dependency-injection pattern is used instead of mocking), zero `expect(true).toBe(true)`-shaped tautologies, zero `toBeInTheDocument`-only smoke tests. One very minor, non-blocking observation: `mcp.test.ts`'s annotation-table test iterates `for (const tool of tools)` with no explicit non-empty guard inside that specific test — but a sibling test in the same file (`toHaveLength(9)`) already guarantees the array is never empty, so this is not a ghost-loop risk in practice.

**Assertion quality**: ✅ All assertions verify real behavior (0 CRITICAL, 0 WARNING)

### Quality Metrics

**Linter**: ✅ No errors (`pnpm lint`, re-run independently)
**Type Checker**: ✅ No errors (`pnpm typecheck`, re-run independently, all 4 packages)

### Issues Found

**CRITICAL**: None.

**WARNING (SHOULD-FIX)**:

1. **Cold-start budget is CI-unvalidated, contrary to the requirement's literal MUST clause.** `openspec/changes/eds-package/specs/mcp-conformance/spec.md`'s "Cold-Start Time Budget" requirement states the threshold "MUST" be derived from "at least 15 cold spawns... measured on the actual CI runner (not a local development machine)." The delivered `COLD_START_BUDGET_MS = 250` (`packages/mcp-testing/src/conformance/cold-start.ts:38`) is derived from a **local** measurement (N=20, p50=45.0ms, p95=46.6ms) via the documented formula, explicitly and honestly disclosed as PROVISIONAL in the same file's comment block. This is also proposal.md's Success Criteria bullet: *"A cold-start threshold exists in the `mcp-conformance` spec, derived from N ≥ 15 CI-runner spawns..."* — as literally worded, this bullet is not yet met. This is not a functionality defect (the assertion mechanism itself is proven to work correctly in both directions), and the environment used for this change genuinely cannot trigger a GitHub Actions `workflow_dispatch` job, so this is not attributable to negligence. **Recommendation**: before `servers.json`'s `eds` entry flips from `"planned"` to `"alpha"` (which has not yet happened — confirmed by direct inspection) or before any npm publish, run `node scripts/measure-cold-start.mjs packages/eds dist/mcp.js` inside an actual CI `workflow_dispatch` job on the target runner, and update `cold-start.ts`'s constant and comment block with the real numbers. Track this as an explicit follow-up task rather than closing it silently.

2. **Design Risk 2 (`eds_reindex` nested `oneOf`) was validated only by a hand-rolled JSON-RPC client, not a third-party MCP client UI.** `packages/eds/src/tools/eds-tools.ts`'s header comment discloses this precisely: `tools/list` was proven to emit a well-formed, spec-compliant nested `oneOf` JSON Schema, and both branches were proven to round-trip correctly through the real built server with the SDK's own input validation rejecting near-misses before handler code runs. That evidence is sufficient to justify **keeping** the type-safe nested union over the `superRefine` fallback (the schema is objectively valid JSON Schema and the two most likely failure modes — malformed schema, validation bypass — are both directly disproven). What remains genuinely untested is UX-level: how a specific third-party MCP client (Claude Desktop, Cursor, an agent orchestrator's own UI) *renders* a nested `oneOf` in whatever tool-call form/picker it builds. This is a lower-severity, disclosed residual risk, not a functional defect. **Recommendation**: run one smoke test against an actual MCP client (or the official MCP Inspector) before or shortly after first publish, specifically exercising `eds_reindex`'s full-site branch, and record the result.

**SUGGESTION**:

1. Persistence to `$XDG_CONFIG_HOME/hiberus/eds.json` at mode `0600` is proven generically for `persistCredential` at `packages/mcp-core/src/credentials/resolve.test.ts:73`, but no test in `packages/eds` exercises the *real* `persist: (token) => persistCredential(EDS_DOMAIN, token)` wiring in `cli.ts:264` end-to-end (all `cli.test.ts` cases inject a mocked `persist` callback). Given `client/` purity rules correctly keep this out of `client/`, and the wiring is a one-line pass-through with no eds-specific logic, this is not a meaningful compliance gap — but a single integration test calling the real `main()` with `auth token set` piped input and asserting the resulting file's mode would close the loop completely.
2. `mcp.test.ts`'s reindex probes cover 6 distinct schema-shape cases (accept-both, reject-discriminant-alone, reject-`confirmFullReindex:false`, reject-stray-field-on-paths-branch, reject-empty-paths-on-paths-branch, accept-paths-happy-path) but do not include a case for `{scope:"paths"}` with the `paths` key **entirely omitted** (as opposed to present-but-empty). Since `nonEmptyPaths` is a required field reused identically across three tool schemas, and the omitted-key case is directly proven for `eds_get_status_bulk`/`eds_set_live_state`, this is a very low-risk gap given the shared-schema construction, not a functional concern.

### Verdict

**PASS WITH WARNINGS**

The implementation is functionally complete and honestly reported: 278/278 tests pass on independent re-run, all four delta specs' 36 scenarios map to real, passing, non-trivial test coverage, every proposal Success Criterion is met except the literal wording of the cold-start CI-runner sourcing (disclosed, provisional, with a clear and already-available remediation path before publish), and every adversarial probe run in this pass (throttle-branch mutation, reindex gate, shellOutProbe-unweakened claim, template/fixture-server coupling) held. No CRITICAL findings. The two SHOULD-FIX items are both pre-existing, explicitly disclosed by the apply batches (not discovered as hidden gaps) and do not block merging this branch; they should be tracked as explicit follow-up work before the `eds` package's `servers.json` status flips from `"planned"` to `"alpha"` and before its first npm publish.
