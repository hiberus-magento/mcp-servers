# Tasks: eds-package — `hiberus-eds` CLI and `hiberus-eds-mcp` server

> Size note: this checklist exceeds the usual 530-word budget for the same reason
> design.md exceeded its own 800-word budget: the orchestrator brief requires every
> spec requirement mapped to a task, a RED test preceding every GREEN implementation
> task (Strict TDD), every applicable threat-matrix case covered, and explicit
> decision points instead of silent fallbacks. Density, not padding.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,500–5,000 (new client, adapters, tests, conformance amendment) |
| 400-line budget risk | High |
| Chained PRs recommended | No — delivery strategy is `exception-ok` |
| Suggested split | Single change, `size:exception` |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (informational only — no chaining)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Scaffold + conformance probe (Phases 1–2) | single change (size:exception) | `pnpm --filter @hiberus-magento/mcp-testing test` | `node packages/mcp-testing/src/conformance/fd1-probe-harness.mjs <serverPath> divert` | Revert one `mcp-testing` commit; additive, no other package affected |
| 2 | Client layer (Phases 3–5) | single change (size:exception) | `pnpm --filter @hiberus-magento/eds test` | N/A — pure unit tests over `FetchDouble`, no live server | `packages/eds/src/client/**` is net-new; delete the directory |
| 3 | Auth + adapters + hazard gates (Phases 6–8) | single change (size:exception) | `pnpm --filter @hiberus-magento/eds test` | `node packages/eds/dist/mcp.js` via `JsonRpcClient` | `packages/eds/src/{cli,mcp}.ts` net-new; delete and re-scaffold |
| 4 | Conformance wiring, manifest, closing gates, cold-start (Phases 9–12) | single change (size:exception) | `pnpm test` (root) | `describeConformance` against the built `hiberus-eds-mcp` bundle | Revert `servers.json`/`README.md`/`openspec/config.yaml` entries |

## Phase 1: Scaffold & Template Hygiene

- [x] 1.1 Run `pnpm new-server eds --domain eds --bin hiberus-eds-mcp --description "Edge Delivery Services (EDS) Admin API client — CLI and MCP server."` to scaffold `packages/eds/**`, register it in `servers.json`, and regenerate `README.md`.
- [x] 1.2 Rename `packages/eds/src/server.ts` to `packages/eds/src/mcp.ts`; update `packages/eds/tsup.config.ts`'s `entry` from `src/server.ts` to `src/mcp.ts`. Also updated `packages/eds/package.json`'s `bin.hiberus-eds-mcp` from `dist/server.js` to `dist/mcp.js` to match the renamed entry (not explicit in this task's text, but required for the entry rename to build a correctly-named bin target).
- [x] 1.3 Delete `packages/eds/src/tools/read-echo.ts` and `packages/eds/src/tools/read-echo.test.ts`; remove the `noop` and `read-echo` tool registrations from `packages/eds/src/mcp.ts` — EDS ships no decorative tool.
- [x] 1.4 Note (no edit needed): `scripts/fixture-server-regeneration.test.mjs` (read-only) couples `templates/server/` to `packages/fixture-server/` only — the eds tool removal in 1.3 is package-local and does not touch that coupling.

## Phase 2: mcp-conformance — Domain-Independent fd-1 Purity Probe

Lands before the EDS tools (Phase 7): EDS is pure-HTTPS and cannot satisfy today's shell-out-based assertion alone, and CI must block from day one.

- [x] 2.1 RED: add a failing test in `packages/mcp-testing/src/conformance/conformance-checks.test.ts` asserting an exported `checkStdoutPurity(lines)` flags a non-JSON-RPC raw stdout line (function does not exist yet).
- [x] 2.2 GREEN: extract `checkStdoutPurity` out of the existing purity `it()` in `packages/mcp-testing/src/conformance/conformance.ts`, exporting it (mirrors the `checkToolMetadataComplete` pattern); the existing assertion now calls it.
- [x] 2.3 RED: create `packages/mcp-testing/src/conformance/stdout-purity.test.ts`; write a failing test asserting `fd1-probe-harness.mjs` (not yet created) in `inherit-child` mode makes `checkStdoutPurity` report a violation (the positive control).
- [x] 2.4 GREEN: create `packages/mcp-testing/src/conformance/fd1-probe-harness.mjs` implementing `inherit-child` mode: spawn a grandchild with `stdio: "inherit"` writing one line to fd 1.
- [x] 2.5 RED: extend `stdout-purity.test.ts` with a failing test asserting `divert` mode, run against the built `packages/fixture-server/dist/server.js` (read-only), keeps stdout pure and echoes `console.log`/raw string write/raw Buffer write on stderr each prefixed `[stdout-diverted] `.
- [x] 2.6 GREEN: implement `divert` mode in `fd1-probe-harness.mjs`: `await import(serverPath)`, attempt the three contaminating writes, stay alive for the driving `JsonRpcClient` session.
- [x] 2.7 RED: add a failing test asserting `describeConformance` runs the domain-independent probe as a mandatory `it()`, independent of `shellOutProbe`. Implemented as an extracted, directly-testable `runFd1DivertProbe({ serverPath })` (mirrors the `checkStdoutPurity`/`checkToolMetadataComplete` extraction pattern) rather than introspecting vitest's registered test tree from outside — the RED test asserted the not-yet-existing function against the real compliant fixture-server bundle and a negative-control subject.
- [x] 2.8 GREEN: implemented `runFd1DivertProbe` in `conformance.ts`, spawning `fd1-probe-harness.mjs <options.serverPath> divert` as a second, independent `JsonRpcClient` session and returning `checkStdoutPurity` violations; wired it into `describeConformance` as an unconditional `it()` (no `shellOutProbe` guard). Verified by running `conformance.test.ts` with `--reporter=verbose`: the new "keeps stdout pure via the domain-independent fd-1 probe, independent of shellOutProbe" test genuinely appears and passes against the real fixture-server bundle.
- [x] 2.9 RED: created `no-shell-tool-subject.fixture.mjs` (a compliant, inline-guarded raw JSON-RPC subject with a tool that is NOT named "read-echo") and `shell-out-probe-optional.test.ts` calling `describeConformance` at module scope with no `shellOutProbe`. Confirmed RED via `--reporter=verbose`: exactly the exec-probe `it()` timed out (5009ms — no `tools/call` handler for the still-defaulted "read-echo" lookup), while every other `it()` (including the fd-1 probe, thanks to the subject's inline guard) passed cleanly — an isolated failure for the right reason.
- [x] 2.10 GREEN: guarded the shell-out `it()` with `if (options.shellOutProbe)` in `conformance.ts`; removed the `options.shellOutProbe ?? DEFAULT_SHELL_OUT_PROBE` fallback (kept `DEFAULT_SHELL_OUT_PROBE` exported for callers that want it explicitly) and updated `conformance.test.ts` (fixture-server) to pass `shellOutProbe: DEFAULT_SHELL_OUT_PROBE` explicitly, preserving its exec-based coverage unweakened. Re-ran both files: `shell-out-probe-optional.test.ts` now has 5/5 passing with the exec-probe `it()` entirely absent; `conformance.test.ts` still has all 7/7 passing including the exec probe.
- [x] 2.11 RED (as designed — see 2.12): added a hand-rolled raw JSON-RPC subprocess in `stdout-purity.test.ts` whose `tools/call` handler spawns a `stdio: "inherit"` grandchild, asserting `checkStdoutPurity` reports the violation.
- [x] 2.12 GREEN: confirmed the test passes immediately via the already-generalized `checkStdoutPurity` from 2.2, with zero production change — exactly as `tasks.md` anticipated. This is the standing regression guard proving the exec-based hazard (M4) stays detectable now that the domain-independent probe (M1) is additive, not a replacement.
- [x] 2.13 Export `checkStdoutPurity` (and any new violation type) from `packages/mcp-testing/src/index.ts`.
- [x] 2.14 Added an eslint `no-restricted-syntax` rule to `eslint.config.js` banning `Property[key.name='stdio'][value.value='inherit']` under `packages/**/src/**` (plus `packages/*/eslint-fixtures/**`), with `ignores` for `fd1-probe-harness.mjs` AND for `packages/mcp-core/src/exec/**` + its two exec fixtures — the latter to avoid flat config's last-match-wins silently replacing the pre-existing exec-boundary `no-restricted-syntax` array for those files (the exact bug class this file already documents).
- [x] 2.15 RED-equivalent: created `packages/mcp-testing/eslint-fixtures/stdio-inherit-violation.ts` and `packages/mcp-testing/eslint-fixtures.test.ts` (mirrors `packages/mcp-core/eslint-fixtures.test.ts`, read-only) asserting `no-restricted-syntax` fires on the violation AND does not fire on the harness.
- [x] 2.16 GREEN: both assertions passed on first run — no selector/ignores adjustment needed. Verified the "harness is exempt" assertion is non-vacuous by temporarily removing the harness's `ignores` entry, re-running (the harness test then failed exactly as expected), and restoring it. Also confirmed mcp-core's own exec-boundary `eslint-fixtures.test.ts` (5/5) and full `mcp-core` suite (76/76) plus root `eslint .` are unaffected.

## Phase 3: Client — Errors, Auth Header, Pacing & Retry

- [x] 3.1 Create `packages/eds/src/testing/fetch-double.ts` — a route-table fetch double + call recorder, outside `client/` so the purity scan and boundary lint stay clean.
- [x] 3.2 RED: failing test asserting a raw `429` maps to `AdminRateLimitError`, a `503` with `x-error` containing `"(429)"` maps to `ContentSourceThrottledError`, and a `503` without it maps to `UpstreamUnavailableError` (three assertions). Confirmed RED via module-not-found (`errors.js`/`http.js` did not exist yet) before implementing.
- [x] 3.3 GREEN: create `packages/eds/src/client/errors.ts` (the `EdsError` hierarchy: `AdminRateLimitError`, `ContentSourceThrottledError`, `UpstreamUnavailableError`, `TransientNetworkError`, `GatewayError`, `JobTimeoutError`) and add `mapThrottle(status, headers)` to `packages/eds/src/client/http.ts` as the sole construction site for both throttle classes.
- [x] 3.4 RED: type-level test in `packages/eds/src/client/errors.test-d.ts` (`vitest --typecheck`) asserting a `switch` on `throttledBy` missing a case is a compile error under `@ts-expect-error` on the exhaustive branch.
- [x] 3.5 GREEN: adjust `errors.ts`'s literal discriminants until 3.4 passes — passed on first run given the literal `as const` discriminants already in place.
- [x] 3.6 RED: type-level test in `packages/eds/src/client/retry.test-d.ts` asserting `ContentSourceThrottledError` is rejected (`@ts-expect-error`) by the retry policy's input type.
- [x] 3.7 GREEN: create `packages/eds/src/client/retry.ts` — pure `(outcome, attempt) -> {retry, delayMs}` over `AdminRateLimitError | TransientNetworkError | GatewayError`, max 3 attempts (`MAX_RETRY_ATTEMPTS`), full-jitter backoff (base 250 ms, cap 4 s), honoring `retryAfterMs`, gated on a required `idempotent: boolean` field.
- [x] 3.8 RED: failing test asserting the retry policy never retries a descriptor with `idempotent: false`.
- [x] 3.9 GREEN: confirm/adjust `retry.ts`'s guard until 3.8 passes — passed on first run.
- [x] 3.10 RED: failing test under `vi.useFakeTimers()` asserting more than 10 queued requests never exceed 10 sent within any one-second window. First implementation attempt (continuous-refill token bucket) genuinely FAILED this test (19 sends observed in one window) — a real finding, not a scripted RED, documented in `rate-limiter.ts`'s header comment.
- [x] 3.11 GREEN: create `packages/eds/src/client/rate-limiter.ts` — sliding-window request log (`ratePerSecond: 10, burst: 10`) over injected `now`/`sleep`; switched from a continuous-refill token bucket after 3.10 proved that design allows `burst + ratePerSecond` sends in a window straddling the initial burst, which a sliding-window log cannot do by construction.
- [x] 3.12 RED: failing test asserting every Admin API request carries `X-Auth-Token: <key>` using a caller-supplied key, never `process.env`.
- [x] 3.13 GREEN: build `packages/eds/src/client/http.ts`'s `send()` boundary — attaches the auth header, awaits the rate limiter, is the single request-building function.

## Phase 4: Client — Operations, Jobs, Cursor, Paths, Tolerant Shapes

- [x] 4.1 RED: failing test asserting a job `GET` returning `202` is treated as success, plus a source-scan test asserting no `=== 200` literal governs job success under `client/**`. First `jobs.ts` pass deliberately used a strict-equality check against the literal HTTP 200 status code; both the 202-fixture test and the source-scan test genuinely failed against it before the fix.
- [x] 4.2 GREEN: create `packages/eds/src/client/jobs.ts` — envelope parsing, `waitForJob` polling `response.ok` (2xx), polling `links.self` verbatim, terminal on `state ∈ {completed, stopped}`, `timeoutMs` 300000 / `pollIntervalMs` 1000 injected, `JobTimeoutError` on timeout carrying `progress` + `self`.
- [x] 4.3 RED: failing test asserting `waitForJob`'s `onProgress` callback fires while the client itself writes nowhere.
- [x] 4.4 GREEN: wire `onProgress?: (p: JobProgress) => void` through `jobs.ts`.
- [x] 4.5 RED: failing test asserting a paginated response's `nextToken` round-trips through `fetchPage`.
- [x] 4.6 GREEN: create `packages/eds/src/client/cursor.ts` — `fetchPage` returning `{ entries, nextToken }`, never auto-draining.
- [x] 4.7 RED: failing test asserting `code` endpoints address by `{owner}/{repo}` and snapshot paths reject a `ref` parameter (pinned to `main`) — including a type-level `@ts-expect-error` on a `ref` field.
- [x] 4.8 GREEN: create `packages/eds/src/client/paths.ts` (`sitePath` generalized over a `resource` verb, `codePath`, `snapshotPath`).
- [x] 4.9 RED: failing test asserting a bare-array site-list response and `{ sites: [...] }` both normalize to the same shape.
- [x] 4.10 GREEN: create `packages/eds/src/client/types.ts` — wire/domain types plus `parseSiteList()`.
- [x] 4.11 RED: failing test asserting a `GET` precedes any config `PUT`, and a caught `409` is never the sole existence check (recorder asserts call order). First `site-config.ts` pass deliberately caught a 409 from the PUT as its existence check; the test genuinely failed (no GET was ever recorded) before the fix.
- [x] 4.12 GREEN: create `packages/eds/src/client/operations/site-config.ts` — `getSiteConfig()` before any write; aggregates site doc + CDN + effective config for `eds_get_site_config`.
- [x] 4.13 RED: failing test asserting a snapshot-creating POST always carries a non-empty JSON body with a `content-type` header, with or without caller-supplied paths.
- [x] 4.14 GREEN: create `packages/eds/src/client/operations/snapshots.ts` — list/show/add/remove/publish/review/delete, always an explicit body (`paths` defaults to `[]`, never an omitted body).
- [x] 4.15 RED: failing test asserting a bulk publish response naming `/.helix/config` among ignored paths surfaces it in the result.
- [x] 4.16 GREEN: create `packages/eds/src/client/operations/live.ts` (bulk publish/unpublish, `ignoredPaths`) and `packages/eds/src/client/operations/status.ts` (single + bulk status).
- [x] 4.17 RED: failing test asserting `eds_reindex`'s full-site branch never sends a bodyless POST, and the paths branch sends submitted paths verbatim.
- [x] 4.18 GREEN: create `packages/eds/src/client/operations/index-ops.ts` — always an explicit body on both branches.
- [x] 4.19 RED: failing test asserting the audit-log operation passes through `since`/`nextToken` and returns the response's `nextToken`.
- [x] 4.20 GREEN: create `packages/eds/src/client/operations/audit-log.ts`.
- [x] 4.21 RED: failing test asserting `mintApiKey()` returns `{ id, value, roles, expiresAt }` as a plain object (no rendering), and `authStatus()` probes `GET /config/{org}.json`, `GET /config/{org}/sites.json`, and — when a site is configured — `GET /status/{org}/{site}/main/`, returning per-probe path/status/verdict, never the token.
- [x] 4.22 GREEN: create `packages/eds/src/client/auth.ts` — `TokenProvider` wiring (consumed via `EdsClientDeps.tokenProvider`, from `mcp-core`, unmodified), `mintApiKey`, `authStatus`.
- [x] 4.23 RED: failing test asserting `packages/eds/src/client/index.ts`'s value exports include `createEdsClient` and every error class. Note (deviation, documented not silent): a runtime test can only assert VALUE exports — TypeScript interfaces/types are erased at runtime, so "exactly … every `*Result` type — nothing else" for pure type exports is enforced by this file's own type-only export list and manual review, not by a runtime assertion. `retry.ts`/`rate-limiter.ts`/`paths.ts` internals are deliberately NOT re-exported.
- [x] 4.24 GREEN: create `client/index.ts`, assembling `createEdsClient(deps: EdsClientDeps): EdsClient` from Phases 3–4's modules into a grouped `{ http, jobs, cursor, auth, operations: { siteConfig, snapshots, live, status, indexOps, auditLog } }` surface.

## Phase 5: Client Purity & Boundary Lint

- [x] 5.1 RED: failing source-scan test asserting no file under `packages/eds/src/client/**` contains `console.`, `process.exit`, `process.env`, a prompt-library import, or an ANSI escape sequence. Genuinely failed on first run — `http.ts`'s own header comment mentioned "process.env" in prose, which the scan correctly flagged; the comment was reworded (no production code was ever affected).
- [x] 5.2 GREEN: fixed the one call site 5.1 surfaced (a comment, not code) — the client was already compliant by construction; the test proves it.
- [x] 5.3 Create `packages/eds/eslint-fixtures/deep-client-import.ts` (a real violation importing `../src/client/http.js` directly) and `packages/eds/eslint-fixtures.test.ts` asserting `no-restricted-imports` fires against it, naming `client/index`.

## Phase 6: Auth Wiring — mcp-core Consumption + CLI Auth Commands

- [x] 6.1 RED: failing test asserting `resolveCredentialValue({ domain: "eds", envVar: "EDS_TOKEN" })` wins over the config file when both are present. Implemented in `packages/eds/src/credential-provider.ts`'s `createEdsTokenProvider` (a thin wiring layer, not a `client/` file).
- [x] 6.2 GREEN: wire `client/auth.ts`'s `TokenProvider` need to `StaticTokenProvider` with EDS's own `Remedy` (out-of-band Adobe UI step in `reason`), constructed only from `credential-provider.ts` (consumed by `cli.ts`; `mcp.ts` wiring is Phase 7), never inside `client/`.
- [x] 6.3 RED: failing test asserting `hiberus-eds auth token set --token abc123` / a positional token argument are all rejected before persisting anything. Proven to genuinely fail: temporarily removed `cli.ts`'s positional-argument arity check and reran — the positional-argument test failed for the right reason before the check was restored.
- [x] 6.4 GREEN: wire `packages/eds/src/cli.ts`'s `runCli` entry to call `parseCredentialCliArgs(argv)` before dispatch, plus an arity check rejecting any extra argument to `auth token set`.
- [x] 6.5 RED: failing test asserting a piped token persists via `persist(token)` (the injected callback wired to `persistCredential("eds", token)` at mode `0600` by the caller) — `setToken` itself takes no token parameter.
- [x] 6.6 GREEN: implement `auth token set` as `setToken(deps: { readStdin, persist })` — no token parameter in its signature.
- [x] 6.7 RED: failing test asserting the exported `CLI_OPTIONS: readonly OptionSpec[]` contains no `name` matching `/token|key|secret|password/i`.
- [x] 6.8 GREEN: define `CLI_OPTIONS` in `cli.ts` (`--site`, `--roles`, `--persist`).
- [x] 6.9 RED: failing test asserting `auth mint`'s output prints the minted value alone on stdout, stderr carries the unrecoverable-value banner + key id + roles + expiry + next command, and the value appears exactly once across both streams.
- [x] 6.10 GREEN: implement `auth mint` calling `client.auth.mintApiKey()`; `--persist` is explicit, never default, and prints the path it wrote.
- [x] 6.11 RED: failing test asserting `auth mint --roles config_admin` (unconfirmed, CLI-observed-only) is rejected while the documented closed set is accepted.
- [x] 6.12 GREEN: implemented `--roles` as a closed zod enum. **Verification limitation, reported honestly, not silently invented**: this environment has no live web-fetch capability, so the enum could NOT be independently re-verified against `https://www.aem.live/docs/admin.html` as instructed. The closed set (`author`, `publish`) is limited to what this repository's own `design.md` bootstrap example already evidences (`--roles publish,author`) — not a wider guess. `basic_author`/`basic_publish`/`config`/`config_admin` remain rejected until a human with live doc access corroborates the confirmed set (resolves Open Question 3 only partially — flagged as a residual risk, see apply-progress).
- [x] 6.13 RED: failing test asserting `auth status` output never contains the raw token under any outcome, reporting an 8-hex-character fingerprint instead.
- [x] 6.14 GREEN: implement `auth status` calling `client.auth.authStatus()`, piping every line through `redact()`; exit 0 if any probe returned 2xx (`reachable`), else 1.
- [x] 6.15 RED: failing test asserting a credential file at mode `0644` surfaces `LooseCredentialFilePermissionsError`'s message verbatim on `auth status`/`auth token set`, not a generic "missing credential".
- [x] 6.16 GREEN: made `auth status` and `auth token set` call `resolveEdsCredentialDirect` (wrapping `resolveCredentialValue`) directly, bypassing `StaticTokenProvider`'s catch-and-rethrow (documented wart mitigation; no `mcp-core` change).

## Phase 7: MCP Adapter — Nine Tools & Hazard Gates

- [x] 7.1 RED: type-level test in `packages/eds/src/mcp.test-d.ts` (`vitest --typecheck`) asserting `{ scope: "full-site" }` alone and with `confirmFullReindex: false` are not assignable to `edsReindexInput`'s inferred type (`@ts-expect-error`). Confirmed genuinely RED by temporarily widening `confirmFullReindex` to `z.boolean()`: the `@ts-expect-error` directives then reported "Unused" (compile now succeeded) — proven, not scripted — before restoring `z.literal(true)`.
- [x] 7.2 GREEN: define `reindexRequest` as `z.discriminatedUnion("scope", [...])` nested under `edsReindexInput = z.object({ site, ref?, request: reindexRequest }).strict()` in `packages/eds/src/mcp.ts`.
- [x] 7.3 RED: failing runtime test asserting `edsReindexInput.safeParse` rejects `{request:{scope:"full-site"}}`, `{request:{scope:"full-site",confirmFullReindex:false}}`, and a stray field on the `paths` branch. Same temporary-widen experiment as 7.1 also flipped the runtime rejection test from pass to fail (`expected true to be false`), proving the gate over both type and runtime surfaces.
- [x] 7.4 GREEN: adjust the schema until 7.3 passes.
- [x] 7.5 RED: failing runtime test asserting `nonEmptyPaths` rejects an omitted or empty `paths` array for `eds_get_status_bulk`, `eds_set_live_state`, and `eds_reindex`'s `paths` branch. Confirmed genuinely RED by temporarily dropping `.min(1)` from `nonEmptyPaths`: 4 tests (the three tools plus the schema's own direct check) genuinely failed before restoring.
- [x] 7.6 GREEN: define `nonEmptyPaths = z.array(z.string().min(1)).min(1)` and reuse it across the three schemas (and, per design.md's Decision-7 table, `eds_manage_snapshot`'s optional `paths` field too).
- [x] 7.7 RED: type-level test asserting an empty array literal is rejected (`@ts-expect-error`) at the client-boundary `paths: readonly [string, ...string[]]` parameter (already the type from Phase 4; `mcp.test-d.ts` adds the direct compile-time proof against `setLiveState`).
- [x] 7.8 GREEN: client boundary parameters (`getStatusBulk`, `setLiveState`, `reindex`'s paths branch) were already typed as the non-empty tuple from Phase 4 — confirmed, no change needed.
- [x] 7.9 Decision point (recorded in `mcp.ts`'s header comment, not applied silently): built `dist/mcp.js` and drove it end-to-end over the real JSON-RPC wire with a hand-rolled client (no third-party MCP client such as Claude Desktop was available in this environment — that wider claim is explicitly NOT made). Confirmed: `tools/list` returns well-formed JSON Schema — `request` renders as a valid nested `oneOf` with `const`-literal discriminants; `tools/call eds_reindex` with `{scope:"full-site"}` (no `confirmFullReindex`) is rejected by the SDK's own input validation before any handler code runs (`MCP error -32602 ... expected true at request.confirmFullReindex`); `eds_get_status_bulk` with `paths: []` is likewise rejected (`Too small: expected array to have >=1 items at paths`). On this evidence the nested discriminated union is KEPT — not downgraded to `superRefine`.
- [x] 7.10 RED: failing test asserting `tools/list` (via `createEdsTools`, unit-level) returns exactly the nine named tools and no others. Confirmed genuinely RED by temporarily duplicating `edsGetStatus` in the returned array: the exactness assertion failed with a visible diff before the duplicate was removed.
- [x] 7.11 GREEN: registered `eds_get_status`, `eds_get_status_bulk`, `eds_set_live_state`, `eds_get_site_config`, `eds_reindex`, `eds_get_audit_log`, `eds_get_snapshots`, `eds_manage_snapshot`, `eds_get_job_status` via `defineTool()` in `mcp.ts`'s `createEdsTools()`, each description opening with "Use this...".
- [x] 7.12 RED: failing test asserting each tool's `readOnlyHint`/`destructiveHint`/`idempotentHint` matches the documented table.
- [x] 7.13 GREEN: annotations set to match; verified against 7.12 (passed on first run given the table was implemented directly from design.md).
- [x] 7.14 RED: failing test asserting a tool call with no `EDS_TOKEN` and no persisted config returns `isError: true` naming `hiberus-eds auth token set`, with no hang. Confirmed genuinely RED by temporarily setting `EDS_TOKEN` before the call: the test failed with a *different* error (a fetch-double JSON parse error further down the real call path), proving the assertion is driven by genuine credential resolution, not a vacuous mock.
- [x] 7.15 GREEN: confirmed satisfied by `defineTool.invoke`'s existing `MissingCredentialError` handling once `mcp.ts`'s runtime (client + `TokenProvider`, via `credential-provider.ts`) is wired.
- [x] 7.16 RED: failing test asserting `mcp.ts` installs `createStdioServer()` and passes its private `stdout` into `new StdioServerTransport(process.stdin, stdout)` (source-scan assertion, mirroring `jobs.test.ts`'s own-source-scan pattern).
- [x] 7.17 GREEN: confirmed `mcp.ts` (already guard-installed from the Phase 1 scaffold) still does so after the tool-registration rewrite.
- [x] 7.18 (Addition beyond the original checklist, disclosed not silent) `eds_get_job_status` needs to build a job path from `site`/`ref`/`topic`/`name` components, but the client-boundary lint forbids an adapter reaching `client/paths.ts` directly. Added `getJobStatus(http, {org,site,ref?,topic,name})` to `client/jobs.ts` (RED-first: `jobs.test.ts` extended and confirmed failing on `getJobStatus is not a function` before implementing), exported from `client/index.ts`, and wired into `EdsClient.jobs.getJobStatus`.
- [x] 7.19 (Addition, disclosed) `mcp.ts`'s runtime (client + org) is resolved LAZILY on the first tool CALL via `createRuntimeResolver()`, not eagerly at module load / process start. Necessary because the shared conformance suite (Phase 9) spawns with a sanitized environment containing only `PATH` — an eager `EDS_ORG` requirement at startup would crash the process before `tools/list` could ever respond, breaking conformance for reasons unrelated to the tools themselves. `EdsToolsConfig` therefore takes `getRuntime: () => EdsRuntime` instead of a pre-built `client`/`org` pair; a missing `EDS_ORG` now surfaces as a per-call `isError: true`, never a startup crash.

## Phase 8: CLI Adapter Closing

- [x] 8.1 RED: failing test asserting the CLI exits `0` on `auth status` success and non-zero on a missing credential. Confirmed genuinely RED by temporarily removing `process.exitCode = result.exitCode;` from `main()`: both tests failed (`expected undefined to be 0` / `expected +0 not to be +0`) before restoring.
- [x] 8.2 GREEN: added `cli.ts`'s `main(argv, deps)` — runs the still-pure `runCli`, then maps `CliRunResult.exitCode` to `process.exitCode` and writes `stdout`/`stderr` to the real streams (never `process.exit()`, which would truncate an in-flight write).
- [x] 8.3 RED: failing test asserting the MCP tool surface (`createEdsTools`) contains no tool corresponding to `site apply`, `site delete`, `site source set`, `key create`, `key delete`, `auth mint`, `code show`, `code sync`, `code delete`, `version restore`, `cache purge`, `robots show`, `sitemap rebuild`.
- [x] 8.4 GREEN: confirmed 8.3 holds given Phase 7 registers exactly nine tools — proves the exclusion per Strict TDD; no CLI implementation of these operations is in scope for this change.
- [x] 8.5 (Addition, disclosed) Discovered during 8.2: the repo-wide `no-restricted-properties` eslint rule bans ALL direct `process.stdout` access outside `mcp-core/src/bootstrap/**`, but `cli.ts`'s `main()` and `auth mint`'s stdout-only value output (design.md, Decision 6) genuinely need it — a CLI binary is not an MCP server and has no JSON-RPC stream to protect. Added `packages/*/src/cli.ts` to that rule's `ignores`, scoped to exactly the one entrypoint file. Proved both directions: created `eslint-fixtures/stdout-write-violation.ts` (an ordinary file using `process.stdout.write`) and confirmed it IS still flagged, and confirmed the real `cli.ts` is NOT flagged — then reran with the new `ignores` entry temporarily removed and confirmed `cli.ts` genuinely fails lint without it, before restoring.

## Phase 9: EDS Conformance Wiring & Packaging Split

- [ ] 9.1 RED: failing test asserting `describeConformance({ serverPath: "packages/eds/dist/mcp.js", packageDir: "packages/eds" })`, called with no `shellOutProbe`, passes stdout purity, the fd-1 probe, tool metadata, and the packaging gate against the real built bundle.
- [ ] 9.2 GREEN: add a conformance entrypoint (e.g. `packages/eds/src/mcp.conformance.test.ts`) invoking `describeConformance` with no `shellOutProbe`.
- [ ] 9.3 Decision point: create `packages/eds/tsup.cli.config.ts` (entry `src/cli.ts`, `outDir: "dist-cli"`) and add `bin.hiberus-eds: "dist-cli/cli.js"` plus `dist-cli` in `files` to `packages/eds/package.json`, updating its `build` script to run both tsup configs — keeps `scripts/verify-bundle.mjs`'s (read-only) G1 single-file gate scoped to `dist/mcp.js` only.
- [ ] 9.4 Create `packages/eds/src/cli.ts` as the real entrypoint (shebang, dispatch table, calls into Phase 6's handlers).
- [ ] 9.5 Run `pnpm --filter @hiberus-magento/eds build && pnpm --filter @hiberus-magento/eds verify:package`; confirm gates G1–G6 pass against `dist/mcp.js`.

## Phase 10: Manifest, README, Config, Docs

- [ ] 10.1 Edit the `eds` entry in `servers.json` (added by Phase 1 with placeholder `TEMPLATE_TOOLS`) to list the real nine tools with `readOnly` flags and "when to use it" descriptions, `bin: "hiberus-eds-mcp"`, `status: "planned"`, `docs: "docs/eds-onboarding.md"`.
- [ ] 10.2 RED: run `node scripts/gen-readme.mjs --check` (read-only script) before 10.3 and confirm it fails — proves staleness detection actually fires.
- [ ] 10.3 GREEN: run `node scripts/gen-readme.mjs` to regenerate `README.md` from the updated manifest; never hand-edit the generated section.
- [ ] 10.4 Add `- eds` under `testing.projects` in `openspec/config.yaml`.
- [ ] 10.5 Create `docs/eds-onboarding.md` documenting the day-one bootstrap sequence (Adobe admin/Sidekick UI → `auth token set` → `auth status` → `auth mint`), using only `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` (read-only) values in every example.

## Phase 11: Closing Gates

- [ ] 11.1 Run `node scripts/audit-synthetic-identifiers.mjs` and fix any reported real-looking identifier.
- [ ] 11.2 Run `node scripts/scan-secrets.mjs` against the change's diff and fix any reported credential-shaped literal.
- [ ] 11.3 Confirm every fixture in `packages/eds/fixtures/*.json` imports `SYNTHETIC_ORG`/`SYNTHETIC_SITES`/`SYNTHETIC_DOMAIN` from `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts` (read-only) rather than inventing per-file values.
- [ ] 11.4 Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` from a clean clone on Node 22; confirm every success criterion in `openspec/changes/eds-package/proposal.md` (read-only) that does not depend on the cold-start number.

## Phase 12: Cold-Start Budget (measured last)

- [ ] 12.1 Create `scripts/measure-cold-start.mjs`: build first, then 20 cold `spawn(process.execPath, ["packages/eds/dist/mcp.js"])` iterations timed from spawn to the `initialize` response, killing between iterations, discarding the first 3 samples.
- [ ] 12.2 Run `node scripts/measure-cold-start.mjs` locally; record local p50/p95 as a sanity check only, explicitly labelled as such.
- [ ] 12.3 Run the measurement via a `workflow_dispatch` CI job on `ubuntu-latest`; compute p95 of the 17 retained CI samples.
- [ ] 12.4 Record `COLD_START_BUDGET_MS = ceil(p95_CI × 1.75)` rounded up to the next 250 ms in `packages/mcp-testing/src/conformance/cold-start.ts`, with a comment block holding N, discarded count, local p50/p95, CI p50/p95, runner label, date, and multiplier.
- [ ] 12.5 RED: failing test asserting `describeConformance` fails when a server's median cold-start (5 samples) exceeds `COLD_START_BUDGET_MS`.
- [ ] 12.6 GREEN: add the cold-start assertion to `describeConformance` in `packages/mcp-testing/src/conformance/conformance.ts` — 5 samples, compare the median to the budget.
- [ ] 12.7 Run `describeConformance` against the real `hiberus-eds-mcp` bundle; confirm the cold-start assertion passes with the recorded threshold.
