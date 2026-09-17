# Tasks: aco-package — `hiberus-aco` CLI and `hiberus-aco-mcp` server

> Size note: this list exceeds the skill's usual 530-word budget for the
> same reason `design.md`'s own preamble states — the change owns five
> separately-decided areas (error model, three credentials, six tools,
> pacing/pagination/admin surface, testing/fixture/cold-start) each under
> Strict TDD, and every requirement/scenario across all four delta specs
> maps to at least one task below. Density over prose; each task is 1-2
> lines, path-first.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 6000-10000+ (new package, ~30 client/adapter/test files, fixtures, docs) |
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
| 1 | Fixture migration (Phase 0) | single PR | `pnpm --filter @hiberus-magento/mcp-testing test catalog-views` | N/A — pure CSV/test change | Revert one commit; additive columns restore exactly |
| 2 | Transport + client domain (Phases 1-2) | single PR | `pnpm --filter @hiberus-magento/aco test client` | N/A — unit/type tests only, no live tenant | `packages/aco` is new; delete the package |
| 3 | Credentials + adapters + conformance (Phases 3-6) | single PR | `pnpm --filter @hiberus-magento/aco test` | `pnpm --filter @hiberus-magento/aco build && node packages/aco/dist/mcp.js` (manual stdio probe) | Same — new package, no external dependents |
| 4 | Cold-start, docs, registration, audits (Phases 7-9) | single PR | `pnpm audit-synthetic-identifiers && pnpm scan-secrets` | N/A — doc/registration/script-only | Revert `servers.json`/`README.md`/docs commit |

## Phase 0: Scaffold & Shared Fixture Migration (blocks everything)

- [x] 0.1 Run `pnpm new-server aco` to scaffold `packages/aco/` from `templates/server/`; verify `package.json`, `tsconfig.json`, `tsup.config.ts`, `src/server.ts`.
- [x] 0.2 Remove template placeholder `packages/aco/src/tools/read-echo.ts` + test; drop `private` in `packages/aco/package.json`.
- [x] 0.3 Add `aco` to `testing.projects` in `openspec/config.yaml`.
- [x] 0.4 RED: extend `packages/mcp-testing/src/fixtures/catalog-views.test.ts` — exact header order incl. new columns; prefix/currency membership; `columns.slice(0,4)` additive guard; both existing `it()` blocks stay byte-identical.
- [x] 0.5 GREEN: migrate `packages/mcp-testing/src/fixtures/catalog-views.csv` header to `vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency`, synthetic values only.
- [x] 0.6 Add `SYNTHETIC_CURRENCIES`, `SYNTHETIC_AC_VIEW_ID_PREFIX`, `SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX` to `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`.
- [x] 0.7 Run `pnpm --filter @hiberus-magento/eds test` to prove `eds`'s suite stays green against the migrated fixture.

## Phase 1: Transport & Error Model (deepest departure from `eds`; precedes everything using it)

- [x] 1.1 RED `packages/aco/src/client/graphql.test.ts`: `classify()` has exactly 2 params `(envelope, op)`, no `status`; 200-with-`errors[]` throws before `data` is read; precedence order exact-value > throttle > scope > fallthrough; partial (`data`+`errors`) rejects with `hadPartialData:true`, payload not attached.
- [x] 1.2 GREEN `packages/aco/src/client/graphql.ts`: unexported `Classified` brand, `ClassifiedData<T>`, sole `classify()` construction site.
- [x] 1.3 RED `packages/aco/src/client/errors.test.ts`: each `AcoError` subclass declares `kind`/`remedy`/`signalledBy`/`confidence`; `AdminScopeError` remedy names both exits; `confidence:"heuristic"` is a readable runtime field, not a comment.
- [x] 1.4 GREEN `packages/aco/src/client/errors.ts`: `AcoErrorKind`, `CatalogViewAccessError`, `AdminScopeError`, `AcoThrottledError`, `AcoOperationError`, `AcoTransportError`, `AcoSchemaMismatchError`.
- [x] 1.5 RED (typecheck) `packages/aco/src/client/errors.test-d.ts`: `RetryableAcoError` excludes `AdminScopeError|CatalogViewAccessError|AcoOperationError|AcoSchemaMismatchError` (`@ts-expect-error`).
- [x] 1.6 GREEN: export `RetryableAcoError` from `errors.ts`.
- [x] 1.7 RED `packages/aco/src/client/http.test.ts`: fetch-reject/unparseable-body/no-envelope all map to `AcoTransportError`; a raw 429 with NO `errors[]` is `AcoTransportError` never a throttle, asserted in the same test as a 200-with-throttle-shaped-extension case.
- [x] 1.8 GREEN `packages/aco/src/client/http.ts`: `readEnvelope()` as the ONLY reader of `status`; `AdminTransport`/`MerchandisingTransport`.
- [x] 1.9 RED (typecheck) `packages/aco/src/client/http.test-d.ts`: `MerchandisingTransportDeps` has no `tokenProvider` field (`@ts-expect-error` on access); an admin `GraphQlOperation<"admin",T>` is not assignable to `MerchandisingTransport.execute`.
- [x] 1.10 GREEN: confirm 1.8's `AdminTransportDeps`/`MerchandisingTransportDeps` satisfy 1.9.
- [x] 1.11 RED `packages/aco/src/client/headers.test.ts`: admin request carries `Authorization`+`x-api-key`, no access-token header; unprotected Merchandising request carries only `AC-View-ID`/`AC-Scope-Locale`; stub access-token supplier's header attached exactly once.
- [x] 1.12 GREEN `packages/aco/src/client/headers.ts`: `AcoHeaderName` union, excludes `X-Auth-Token` structurally.
- [x] 1.13 RED/GREEN: source-scan test (alongside `client/purity.test.ts`) asserting `/X-Auth-Token/i` appears nowhere under `packages/aco/src/**`.
- [x] 1.14 RED `packages/aco/src/client/rate-limiter.test.ts`: N requests never exceed `ADMIN_PACE`/`MERCH_PACE` window under `vi.useFakeTimers()` — mirrors `packages/eds/src/client/rate-limiter.test.ts` (read-only) pattern.
- [x] 1.15 GREEN: copy `packages/eds/src/client/rate-limiter.ts` (read-only) into `packages/aco/src/client/rate-limiter.ts`; own `ADMIN_PACE`/`MERCH_PACE` constants, chosen-not-documented note.
- [x] 1.16 RED/GREEN `packages/aco/src/client/retry.ts` + `.test.ts` + `.test-d.ts`: `RetryableAcoError = AcoThrottledError|AcoTransportError` only; required `idempotent`; six mutations declare `idempotent:false`.
- [x] 1.17 RED/GREEN `packages/aco/src/client/cursor.ts` + `.test.ts`: only `ListPriceBooksResult` is assignable to `ScrollPage`.
- [x] 1.18 RED `packages/aco/src/testing/fetch-double.test.ts`: route key `"<METHOD> <pathname> <operationName>"`; `graphQlOk`/`graphQlErrors`/`graphQlPartial`/`transportFailure` helpers; 200-with-errors test asserts BOTH `status===200`/`ok===true` AND a rejected typed `AcoError` in one test.
- [x] 1.19 GREEN `packages/aco/src/testing/fetch-double.ts`.
- [x] 1.20 RED source-scan: every document under `client/operations/` is a NAMED operation, never anonymous (test lands here, passes once Phase 2 operations exist).

## Phase 2: Client Domain Layer (depends on Phase 1)

- [x] 2.1 RED `packages/aco/src/client/types.test.ts`: unrecognized extra field passes through; missing OPTIONAL field → `undefined`; missing KEYED field (`channels[].channelId`, `priceBooks.items[].id`, `policies[].policyId`/`name`) → `AcoSchemaMismatchError` naming operation+field.
- [x] 2.2 GREEN `packages/aco/src/client/types.ts`: hand-written TOLERANT narrowing (no `.strict()` — deliberate inversion of the wire-gate rule; do not conflate with 5.2's tool-input `.strict()`).
- [x] 2.3 RED/GREEN `packages/aco/src/client/operations/scopes.ts` + test: named `ListScopes` query.
- [x] 2.4 RED/GREEN `packages/aco/src/client/operations/channels.ts` + test: named `ListChannels` query.
- [x] 2.5 RED/GREEN `packages/aco/src/client/operations/policies.ts` + test: named `ListPolicies` query.
- [x] 2.6 RED/GREEN `packages/aco/src/client/operations/price-books.ts` + test: named `ListPriceBooks` query, `ScrollPage<PriceBook>`.
- [x] 2.7 RED/GREEN `packages/aco/src/client/operations/search.ts` + test: named `SearchCatalog` (`productSearch`) query.
- [x] 2.8 RED `packages/aco/src/client/operations/facets.test.ts`: non-facetable attribute (fixture has no buckets for it) → `{facetable:false,reason}`; `fetchDouble.calls` length is exactly **1** — client-layer structural boundary #1 against the sampling fallback.
- [x] 2.9 GREEN `packages/aco/src/client/operations/facets.ts`: named `FacetValues` query, closed union return type.
- [x] 2.10 RED `packages/aco/src/client/operations/mutations.test.ts`: source-scan — token `mutation ` appears only in this file under `client/`; `AdminMutationName` is a closed 6-member union.
- [x] 2.11 GREEN `packages/aco/src/client/operations/mutations.ts`: `createChannel`/`updateChannel`/`deleteChannel`/`createPolicy`/`updatePolicy`/`deletePolicy`, all named, `idempotent:false`.
- [x] 2.12 RED `packages/aco/src/client/index.test.ts`: factory wires transports/rate-limiters/retry by track; exported surface is exactly the error classes + result types + factory.
- [x] 2.13 GREEN `packages/aco/src/client/index.ts`: the only public surface.
- [x] 2.14 RED `packages/aco/src/client/provision.test.ts`: default issues ZERO mutations; second run vs. unchanged fixture issues none; a zero-match vertical aborts the WHOLE run before any write; view-create is TWO calls (`createChannel` then `updateChannel` for `defaultPriceBookId`).
- [x] 2.15 GREEN `packages/aco/src/client/provision.ts`: four-step pure pipeline over injected values, dry-run default.
- [x] 2.16 RED `packages/aco/eslint-fixtures/deep-client-import.ts`: deliberately imports a deep `client/` path; extend the repo's `eslint-fixtures.test.ts` pattern to assert `no-restricted-imports` fires with the exact rule id for `aco` (boundary-rule FAILURE branch).
- [x] 2.17 GREEN: confirm no production change needed — `eslint.config.js`'s boundary rule already covers `packages/**/src/**`.
- [x] 2.18 RED `packages/aco/src/cross-domain.test.ts`: one row written ACO-side with an `ac_view_id`, read back via the EDS-side config path for the same `(vertical, site)`.
- [x] 2.19 GREEN: add `"@hiberus-magento/eds": "workspace:*"` as `devDependency` in `packages/aco/package.json`; make 2.18 pass proving shared state, not two parses.
- [x] 2.20 Create `packages/aco/fixtures/*.json` backing 2.3-2.15, every value from `synthetic-identifiers.ts`.

## Phase 3: Credential Provider (adapter layer only, never inside `client/`) — the MINT path is primary

> Re-ordered 2026-09-17. An earlier run of this plan put the paste path first, on the evidence that `client_credentials` returned `unauthorized_client`. That test was sound but ran against a credential from a Developer Console project that did not have the **Adobe Commerce Optimizer Admin** API added — and a credential can only request scopes for APIs its project actually has. With that API added and a new OAuth Server-to-Server credential, the grant works: the minted token's decoded JWT payload carries `scope: "commerce.aco.admin,openid,AdobeID"`.
>
> So `MintedTokenProvider` refreshes automatically and all six tools stay alive indefinitely. Build both paths as the tasks below already do, but the mint path is the one that must work on day one; the pasted Bearer remains as an explicit override for an operator without Developer Console access. Both were already specified — only which is primary changed.

- [x] 3.1 RED `packages/aco/src/credential-provider.test.ts`: `selectAdminProvider()` precedence, all 4 input combinations; stored/env Bearer wins unconditionally over client credentials.
- [x] 3.2 GREEN: implement `selectAdminProvider` as a pure function in `packages/aco/src/credential-provider.ts`.
- [x] 3.3 RED same file: `PastedBearerProvider.getToken()` decodes `created_at`/`expires_in` WITHOUT signature verification; elapsed decoded expiry throws `CredentialExpiredError` BEFORE any request (assert fetch double never called).
- [x] 3.4 GREEN: implement `PastedBearerProvider implements TokenProvider` — a domain class over `mcp-core`'s exported, unchanged `TokenProvider` interface.
- [x] 3.5 RED same file, minted path, using `vi.useFakeTimers()` (required: `MintedTokenProvider.getToken()` reads `Date.now()` directly, not an injected clock): two concurrent expired-token calls trigger exactly ONE IMS mint; a live `AdminScopeError` (200-with-errors on an admin route) becomes `CredentialExpiredError` naming both exits, Adobe's message appended, original preserved as `cause`.
- [x] 3.6 GREEN: wire `MintedTokenProvider` (POST `ims/token/v3`, `grant_type=client_credentials`) and `relayCredentialFailure()` — the ONLY place an `AcoError` becomes an mcp-core credential error.
- [x] 3.7 RED: self-heal proof — two calls either side of a config-file rewrite: expired stored Bearer fails call 1, replaced value succeeds on the immediate NEXT call, no restart.
- [x] 3.8 GREEN: confirm `PastedBearerProvider` re-reads `resolveCredentialValue` on every `getToken()` (never cached at startup).
- [x] 3.9 Run `git diff --quiet -- packages/mcp-core/` after this phase — must report zero changes; add as an explicit checked step, not an assumption.

## Phase 4: CLI Adapter

- [x] 4.1 RED `packages/aco/src/cli.test.ts`: `--token`/`--token=` both exit non-zero before persisting; stdin intake persists at mode `0600`; `CLI_OPTIONS` table contains no name matching `/token|key|secret|password/i`.
- [x] 4.2 GREEN `packages/aco/src/cli.ts`: `CLI_OPTIONS`, stdin-only intake, `auth mint`/`auth status`.
- [x] 4.3 RED same file: `provision` with no `--yes` issues zero mutations, output states dry run; `--yes` twice vs. unchanged state issues mutations only on pass 1.
- [x] 4.4 GREEN: wire `provision` command to `client/provision.ts` (via `AcoClient.provisioning.provision` — see Deviations: `cli.ts` cannot deep-import `client/provision.ts` directly under the boundary rule, so `client/index.ts` now wires `provision` onto the returned client instance instead of re-exporting the bare function).
- [x] 4.5 RED same file: every CLI-only op (`provision`, `policy disable --all`, `view prune`, `view delete`, `policy delete`, `auth`/`profile`, `api query`, `policy init`) exists ONLY here; a missing-credential command exits non-zero.
- [x] 4.6 GREEN: implement remaining CLI-only commands.
- [x] 4.7 RED (threat matrix — untrusted upstream text): an `errors[].message` containing `;`, backticks, an ANSI escape, and a token-shaped value is redacted via `redact()` before writing to stderr.
- [x] 4.8 GREEN: apply `redact()` on the CLI error-rendering path.

## Phase 5: MCP Tools & Server (depends on Phases 2, 3)

- [x] 5.1 RED `packages/aco/src/tools/aco-tools.test.ts`: `createAcoTools(...).map(t=>t.name).sort()` deep-equals the six names, `toHaveLength(6)`; negative — `CLI_ONLY_OPERATIONS` list has no corresponding tool name.
- [x] 5.2 GREEN `packages/aco/src/tools/aco-tools.ts`: six `defineTool()` registrations, `.strict()` zod inputs (STRICT — deliberate inverse of 2.2's TOLERANT client parsing).
- [x] 5.3 RED `packages/aco/src/mcp.test-d.ts`: `acoTogglePolicyInput["mode"]` is exactly `"named"`; `{mode:"all",...}` NOT assignable.
- [x] 5.4 GREEN: `nonEmptyPolicyNames` (`min(1).max(50)`), `acoTogglePolicyInput` with `mode: z.literal("named")` only — no `"all"` branch anywhere.
- [x] 5.5 RED runtime: `safeParse` rejects `mode:"all"`, `names:[]`, omitted `names`, unknown keys.
- [x] 5.6 GREEN: confirm 5.4's schema satisfies 5.5.
- [x] 5.7 RED: a policy already at the target `enabled` state issues NO `updatePolicy` for it; result reports `changed:false`. (Deviation, reported: `ListPolicies`'s Q_POLICIES wire shape has no top-level `enabled` field per exploration.md — added `enabled?: boolean` defensively to `PolicyResult`/`LIST_POLICIES_DOCUMENT`, tolerant per Decision 4; when absent, the toggle handler cannot prove a no-op and always writes.)
- [x] 5.8 GREEN: implement the toggle handler's early-exit.
- [x] 5.9 RED (Tier boundary): with no admin credential resolvable, Tier-A tools succeed and all four Tier-B tools return `isError:true` naming `hiberus-aco auth token set`, no hang/throw (six `invoke()` calls, empty config dir).
- [x] 5.10 GREEN: wire `relayCredentialFailure` (3.6) into the four Tier-B handlers; confirm `defineTool.invoke`'s existing catch of `MissingCredentialError`/`CredentialExpiredError` (read-only, `packages/mcp-core/src/tools/define-tool.ts`) needs no change.
- [x] 5.11 RED: description scan — all four Tier-B descriptions contain `hiberus-aco auth token set`; neither Tier-A description does; every description states WHEN to use the tool.
- [x] 5.12 GREEN: write the six tool descriptions.
- [x] 5.13 RED: `aco_get_facet_values` tool-layer boundary #2 — non-facetable attribute returns `{facetable:false,reason}`, exactly ONE product-list request (mirrors 2.8 at the client layer).
- [x] 5.14 GREEN: confirm the tool handler passes the client's closed union through with no added sampling path.
- [x] 5.15 RED: Merchandising-track tools carry no `Authorization`/`x-api-key`/`X-Auth-Token` header for an unprotected view.
- [x] 5.16 GREEN: confirm adapter-level pass-through (satisfied by 1.12/2.7).
- [x] 5.17 RED: five tools annotated `true/false/true`; `aco_toggle_policy` annotated `false/true/true`.
- [x] 5.18 GREEN: set annotations on all six `defineTool()` calls.
- [x] 5.19 Implement `packages/aco/src/mcp.ts`: `hiberus-aco-mcp` entrypoint, `createStdioServer()`, unconditional `server.connect(transport)` at module top level (kept out of `aco-tools.ts` so unit tests import the factory without connecting).

## Phase 6: Conformance & Packaging Gate

- [x] 6.1 RED `packages/aco/src/mcp.conformance.test.ts`: `tools/list` on the BUILT bundle returns exactly the six declared names (deep-equal, sorted) — the artifact-layer proof of 5.1/6.3.
- [x] 6.2 GREEN: `pnpm --filter @hiberus-magento/aco build`; wire `describeConformance` with NO `shellOutProbe`; confirm the domain-independent fd-1 divert probe finds zero stray stdout lines (threat-matrix: subprocess stdio inheritance).
- [x] 6.3 RED: `tools/list`'s `properties.mode.enum` deep-equals `["named"]` for `aco_toggle_policy` on the built bundle — third of the three independent no-`"all"`-branch proofs. (Deviation, reported: the actual JSON Schema this SDK/zod version renders for a single `z.literal` is `{"type":"string","const":"named"}`, never `enum` — `enum` is zod v4's rendering for a union of literals, not a lone literal. The test asserts `properties.mode.const === "named"` and `properties.mode.enum === undefined`, the equivalent no-`"all"`-branch proof against what is actually on the wire; verified empirically against the installed `@modelcontextprotocol/sdk@1.30.0`/`zod@4.5.4` before writing the assertion.)
- [x] 6.4 GREEN: satisfied once 5.4 ships in the built bundle; test confirms (see 6.3's deviation note for the exact field asserted).
- [x] 6.5 RED: `scripts/verify-bundle.mjs` (read-only) run against `packages/aco`'s dist — single file ≤2 MB, none of `express`/`hono`/`cors`/`jose`/`ajv`, tarball `dependencies:{}`, shebang, `LICENSE`.
- [x] 6.6 GREEN: fix `packages/aco/tsup.config.ts`/`package.json` until the gate passes. (Also removed the Phase-0 scaffold's `src/server.ts`/`dist/server.js` bin entry, replaced by the two real entrypoints `cli.ts`/`mcp.ts`, matching `eds`'s shape and design.md's File Changes table, which never lists `server.ts`. Proved G1 can actually fail: touched a stray `dist/stray-chunk.js` and confirmed `verify-bundle.mjs` reports `[G1] dist/ contains .js file(s) beyond the declared bin entries`, then removed it.)
- [x] 6.7 RED `packages/aco/src/client/purity.test.ts`: mirrors `packages/eds/src/client/purity.test.ts` (read-only) — no `console.`/`process.exit`/`process.env`/prompt/ANSI under `client/`. (Already existed from an earlier phase; re-run and confirmed green as part of this phase's full suite run, not re-authored.)
- [x] 6.8 GREEN: satisfied if Phases 1-2 held the constraint; test proves it.

## Phase 7: Cold-Start Trigger (last)

- [x] 7.1 Create `scripts/compare-bundle-size.mjs`: prints `packages/aco/dist/mcp.js` vs `packages/eds/dist/mcp.js` (read-only) byte sizes and the ratio.
- [x] 7.2 Run it. If `|Δ| ≤ 20%`: append a dated note to `packages/mcp-testing/src/conformance/cold-start.ts` recording the ratio, explicitly retaining 250 ms. (Measured: `aco/dist/mcp.js` 1,106,603 bytes vs `eds/dist/mcp.js` 1,085,024 bytes, ratio +2.0%. Trigger did NOT fire; dated note appended, `COLD_START_BUDGET_MS` retained unmodified.)
- [ ] 7.3 If `|Δ| > 20%` instead: run `node scripts/measure-cold-start.mjs packages/aco dist/mcp.js` (read-only script); record a new local-provisional number (N=20, discard 3, p95, `ceil(p95×1.75)` rounded to next 250 ms) in `cold-start.ts`, marked PROVISIONAL; add optional `coldStartBudgetMs` to `ConformanceOptions` in `packages/mcp-testing/src/conformance/conformance.ts` (additive; `eds`'s own assertion passes no override, stays unchanged). — N/A, not applicable: 7.2's branch fired instead (ratio +2.0%, within the 20% band), so per design.md's own conditional ("only if the trigger fires") this branch, including the additive `coldStartBudgetMs` option, was correctly left untouched.
- [x] 7.4 Confirm `describeConformance`'s generic median-of-5 cold-start test (read-only, already generic) passes against `aco` using whichever constant 7.2/7.3 settled. (Passed at the unmodified 250 ms constant, as part of the 8/8 green run of `packages/aco/src/mcp.conformance.test.ts`.)

## Phase 8: Registration & Documentation

- [x] 8.1 Add the `aco` entry to `servers.json` — six real tools, `status:"planned"`, `docs:"docs/aco-onboarding.md"`. (Also fixed `bin` to `hiberus-aco-mcp` and `requires.binaries: ["hiberus-aco"]`, matching the real Phase 6 build output rather than the Phase-0 scaffold's placeholder `noop`/`read-echo` entry. `requires.env` lists `ACO_CLIENT_ID`/`ACO_CLIENT_SECRET` — the mint path, primary per Phase 3's re-ordering — not `ACO_TOKEN`, which is documented in `docs/aco-onboarding.md` as the override path instead. Validated: `node scripts/validate-manifest.mjs` → `servers.json: valid (2 server(s))`.)
- [x] 8.2 Run `scripts/gen-readme.mjs` (read-only); commit only its output — never hand-edit `README.md`. (Ran; `node scripts/gen-readme.mjs --check` confirms the committed file matches.)
- [x] 8.3 Create `docs/aco-onboarding.md` (follows `docs/eds-onboarding.md` precedent). The admin bootstrap must lead with the requirement that trips everyone: **add the "Adobe Commerce Optimizer Admin" API to the Developer Console project and create an OAuth Server-to-Server credential there.** A credential from a project lacking that API fails `client_credentials` with `unauthorized_client` even for bare `openid,AdobeID`, which reads like a broken grant and is not one — this cost real time to diagnose and the doc exists so nobody repeats it. Also document the verification step, because the obvious check is insufficient: IMS can return a valid token carrying FEWER scopes than requested without erroring, so decode the JWT payload (`cut -d. -f2`, base64url) and confirm `commerce.aco.admin` is actually in the `scope` claim. Getting an `access_token` proves nothing on its own. Present minting as the normal path and the pasted Bearer as the override for an operator without console access. (Every credential value in the doc is an obvious placeholder or a shell variable reference — never a real value — and uses `read -rs` so a pasted secret never reaches shell history. Confirmed clean against `scripts/scan-secrets.mjs`'s exact `scanDiff` logic before committing.)
- [ ] 8.4 Flip `servers.json`'s `aco` entry `status` to `"alpha"` in the final commit, after every prior gate is green. — Deferred to the end of Phase 9, once the full pipeline run (task 9.3) has been proven green; flipping earlier would contradict the task's own ordering ("after every prior gate is green").

## Phase 9: Closing Audit Gates

- [ ] 9.1 Run `node scripts/audit-synthetic-identifiers.mjs` — passes, no real customer identifier anywhere in the diff.
- [ ] 9.2 Run `node scripts/scan-secrets.mjs` — passes, no credential-shaped literal anywhere in the diff.
- [ ] 9.3 Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` from a clean state with `packages/aco` included.
