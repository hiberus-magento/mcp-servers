# Tasks: mcp-servers-bootstrap — monorepo scaffolding and shared policy libraries

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | High (greenfield workspace + 2 packages + CI/release + manifest) |
| 400-line budget risk | High (informational only — no PR budget applies) |
| Chained PRs recommended | No |
| Suggested split | Single PR, `size:exception` pre-accepted per delivery strategy |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

`size:exception` is pre-accepted by explicit user directive: no PR size budget, no changed-line limit, no PR required, no commit-count limit. This is purely agentic development on a brand-new repository. The High risk rating above is recorded for information only and is not a blocker.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Entire bootstrap (workspace → packaging gate → mcp-core → mcp-testing → manifest → release → governance) | Single PR (size:exception) | `pnpm test` | `node packages/fixture-server/dist/server.js` driven by the conformance suite's JSON-RPC client | Greenfield repo, zero commits — abandon branch, `master` stays empty |

## Phase 1: Minimal Workspace Bootstrap

- [x] 1.1 Create `pnpm-workspace.yaml` (`packages/*`).
- [x] 1.2 Create root `package.json`: `packageManager` (corepack pin), `engines.node>=22`, `"type":"module"`, scripts `build/lint/typecheck/test/verify:package`.
- [x] 1.3 Create `.nvmrc` (`22`).
- [x] 1.4 Create `turbo.json`: `build{dependsOn:["^build"]}`, `typecheck{dependsOn:["^build"]}`, `lint{}`, `test{dependsOn:["^build"]}`, `verify:package{dependsOn:["build"],inputs:["dist/**"]}`.
- [x] 1.5 Create `tsconfig.base.json` (strict, ESM/NodeNext).
- [x] 1.6 Create `.gitignore`, `.editorconfig`.
- [x] 1.7 Create baseline `eslint.config.js` (flat config, `no-console`, `no-restricted-properties` on `process.stdout`) — boundary/exec/SDK-barrel rules added in Phase 5/10.

## Phase 2: Packaging Gate (blocking — precedes any mcp-core API design)

- [x] 2.1 `packages/fixture-server`: `pnpm add @modelcontextprotocol/sdk@1.30.0 zod tsup` (exact pin, real install, not the sibling-repo evidence).
- [x] 2.2 Write throwaway `packages/fixture-server/src/server.ts` — stdio-only, imports only `server/mcp.js` + `server/stdio.js`, one no-op tool, shebang.
- [x] 2.3 `packages/fixture-server/package.json` (private, `bin`, shebang entry) + `tsup.config.ts` (single ESM bundle, `minify:false`, `metafile:true`, node22 target).
- [x] 2.4 Write `scripts/verify-bundle.mjs`: G1 single `dist/*.js`; G2 size ≤2MB; G3 metafile scan for `express|hono|@hono/…|cors|express-rate-limit|jose|ajv|ajv-formats` inputs + text-grep backstop; G4 `npm pack` → `dependencies:{}`; G5 shebang on bundle+tarball; G6 `LICENSE` in tarball via `tar -tf`.
- [x] 2.5 Wire `pnpm verify:package` (turbo task from 1.4).
- [x] 2.6 RUN `pnpm build && pnpm verify:package` against the real SDK. Record the actual landing rung (a/b/c) in this file before continuing.

  **MEASURED RESULT** (real build, not sibling-repo evidence): `@modelcontextprotocol/sdk@1.30.0` resolved exactly as pinned (peer `zod@4.5.4`).
  - Rung (a) (deep-path import only, no alias): bundle = 1,331,652 bytes (1.27 MB). G3 **failed**: metafile listed 60 `ajv`/`ajv-formats` inputs (`node_modules/.pnpm/ajv@8.20.0/...`, `node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/...`). Zero occurrences of `express`, `hono`, `@hono/node-server`, `cors`, `express-rate-limit`, or `jose` at any depth — confirming the design's prediction exactly.
  - Rung (b) (add `ajv`/`ajv-formats` esbuild alias to named-throwing stubs, inject explicit `jsonSchemaValidator` in `server.ts`): bundle = 1,047,960 bytes (~1.02 MB). **G1–G6 all PASS**: single `dist/server.js`, well under the 2 MB cap, zero forbidden-dependency substrings (metafile + text-grep backstop both clean), `npm pack` tarball declares `dependencies: {}` (achieved by listing the SDK and `zod` as `devDependencies`, not `dependencies` — they are fully bundled, not runtime deps), shebang preserved on both the bundle and the tarball entry, `LICENSE` present in the tarball.
  - **Landing rung: (b).** No rung (c) work was needed.
  - Runtime proof beyond the gate: manually spawned the built `dist/server.js` over real stdio and exchanged `initialize` + `tools/list` JSON-RPC frames — both answered correctly, stdout contained only JSON-RPC frames, stderr was empty. This confirms the `noElicitationValidator` wiring does not break startup or the happy path.

- [x] 2.7 If rung (a) fails only on `ajv`: create named-throwing alias stubs `packages/mcp-core/src/stubs/ajv.js`, `.../stubs/ajv-formats.js` (`throw new StubModuleInstantiatedError(...)` in constructor), add tsup `alias` map, re-run gate → rung (b).
- [x] 2.8 If rung (b) still fails (G3/G7): vendor a minimal JSON-RPC-over-stdio server into `packages/mcp-core/src/vendor/jsonrpc-stdio.ts` (~300 LOC), swap fixture-server's transport import, re-run gate → rung (c). If (c) also fails: STOP, do not proceed to Phase 3; record the blocker and reopen packaging as its own change.

  **N/A — rung (b) passed all gates on the first attempt after adding the alias stubs.** No vendoring was needed.

- [x] 2.9 Add `no-restricted-imports` rule in `eslint.config.js` banning `@modelcontextprotocol/sdk` barrel and `/server/index.js` outside `packages/mcp-core/**`.
- [x] 2.10 RED: fixture `packages/mcp-core/eslint-fixtures/sdk-deep-import-violation.ts` (imports the banned path).
- [x] 2.11 GREEN: `packages/mcp-core/eslint-fixtures.test.ts` runs eslint programmatically over 2.10, asserts the exact rule ID fires.

## Phase 3: mcp-core — Stdout Safety

- [x] 3.1 RED `packages/mcp-core/src/bootstrap/stdout-guard.test.ts`: after bootstrap, `process.stdout.write` forwards to stderr prefixed `[stdout-diverted]`.
- [x] 3.2 GREEN `packages/mcp-core/src/bootstrap/stdout-guard.ts`: `createStdioServer()` captures real `stdout.write`, wraps it in a private `Writable` given only to `StdioServerTransport`.
- [x] 3.3 RED `packages/mcp-core/src/bootstrap/logger.test.ts`: exported logger writes to stderr only, never stdout.
- [x] 3.4 GREEN `packages/mcp-core/src/bootstrap/logger.ts`; add repo-wide `no-console` eslint rule.
- [x] 3.5 RED `packages/mcp-core/src/exec/exec.test.ts`: executor spawns with `stdio:'pipe'`, never `'inherit'`.
- [x] 3.6 GREEN: enforce `stdio:'pipe'` unconditionally in `runAllowlisted` (closes the child-fd-1-inheritance gap).

## Phase 4: mcp-core — defineTool Compile-Time Annotations

- [x] 4.1 RED `packages/mcp-core/src/tools/define-tool.test-d.ts`: `@ts-expect-error` above calls missing `idempotentHint`, mismatched `readOnlyHint:true/destructiveHint:true`, and `description:""`.
- [x] 4.2 GREEN `packages/mcp-core/src/tools/define-tool.ts`: `NonEmpty<S>`, `ToolAnnotations` discriminated union, `defineTool()`.
- [x] 4.3 Wire `vitest --typecheck` (`include:['**/*.test-d.ts']`) into root `pnpm test`.
- [x] 4.4 Add `expectTypeOf` positive-case assertions in 4.1's file.

## Phase 5: mcp-core — Allowlisted Command Executor

- [x] 5.1 RED `packages/mcp-core/src/exec/exec.test.ts`: exact-match allow; prefix-match (`status-extended`) reject; `ssh`/`tunnel`/`db:dump` rejected at registration (module init throws); `--` rejected; schema-invalid argument rejected; `timeoutMs`/`maxOutputBytes` enforced with `SIGKILL`.
- [x] 5.2 GREEN `packages/mcp-core/src/exec/{command-spec,validate-argv,run-allowlisted}.ts`: non-exported `unique symbol` brand → `Argv`; `Map` keyed on full `[bin,...subcommand].join(' ')`; `execFile` with `shell:false`.
- [x] 5.3 RED: property test — `validateArgv`'s returned string is byte-identical to the captured `execFile` argv (no normalize-then-execute-raw divergence).
- [x] 5.4 GREEN: `validateArgv` returns the same array it validated, never a re-derived copy.
- [x] 5.5 RED fixtures `packages/mcp-core/eslint-fixtures/{exec-import,prefix-match}-violation.ts`: `child_process.exec/execSync/spawnSync` import; `RegExp`/`.startsWith`/`.includes`/`.test` under `src/exec/**`.
- [x] 5.6 GREEN: `no-restricted-imports` + `no-restricted-syntax` eslint rules for `src/exec/**`; extend 2.11's programmatic test to assert these rule IDs fire too.

## Phase 6: mcp-core — Truncation & Pagination

- [x] 6.1 RED `packages/mcp-core/src/truncate/truncate.test.ts`: cuts at a UTF-8 boundary, appends marker `[truncated: N of M bytes — request page 2]`.
- [x] 6.2 GREEN `packages/mcp-core/src/truncate/truncate.ts` (defineTool wrapper backstop, applies even if the tool author forgot pagination).
- [x] 6.3 GREEN `packages/mcp-core/src/tools/pagination.ts`: zod fragment `{page:int≥1 default 1, pageSize:int 1..200 default 50}` (concrete defaults — proposal/design left unspecified), `nextPage` in result.
- [x] 6.4 RED: paginated tool test — page 2 returns only that page's items.

## Phase 7: mcp-core — Linear-Time Secret Redaction

- [x] 7.1 RED `packages/mcp-core/src/redact/redact.test.ts`: `token=abc123secret` masked; `https://user:hunter2@example.test` → userinfo masked, `hunter2` absent.
- [x] 7.2 GREEN `packages/mcp-core/src/redact/redact.ts`: one pre-compiled alternation, disjoint bounded-quantifier character classes, no nesting; no `MCP_NO_REDACT` escape hatch.
- [x] 7.3 RED: backtracking-safety property test — redact a 1MB adversarial near-match input and a 100KB one; assert `time(1MB)/time(100KB) < 15` (linear predicts ~10×; this makes the time-vs-input-length property concretely testable without a fixed attack string).
- [x] 7.4 GREEN: confirm 7.3 passes; iterate the pattern under 7.2 until it does.

## Phase 8: mcp-core — Credential Loading

- [x] 8.1 RED `packages/mcp-core/src/credentials/resolve.test.ts`: env wins over config file for same domain; fails when neither present (no third branch, never prompts).
- [x] 8.2 GREEN `packages/mcp-core/src/credentials/{token-provider,resolve}.ts`: `TokenProvider`, `StaticTokenProvider`, `MintedTokenProvider` (single-flight coalescing, generation stamp, required `mintTimeoutMs`).
- [x] 8.3 RED: persisted-file test — `$XDG_CONFIG_HOME/hiberus/<domain>.json` written mode `0600`, dir `0700`; a loose-mode file is refused, not warned about.
- [x] 8.4 GREEN: atomic `writeFileSync(tmp,{mode:0o600})` + `rename`, `stat`-mode refusal on read.
- [x] 8.5 RED `packages/mcp-core/src/credentials/cli.test.ts`: `--token <value>` exits non-zero, message points to stdin/env — no `--token` flag exists at all.
- [x] 8.6 GREEN: CLI parser omits `--token`; export `readTokenFromStdin()`; no argv-token function exists anywhere in `mcp-core`.
- [x] 8.7 RED: `MissingCredentialError`/`CredentialExpiredError` map to `CallToolResult{isError:true}` with remedy text (`cliCommand`,`envVar`,`configPath`,`reason`).
- [x] 8.8 GREEN: `defineTool` wrapper catches both, formats from `describeRemedy()`.

## Phase 9: mcp-testing Conformance Suite

- [ ] 9.1 RED `packages/mcp-testing/src/conformance/conformance.test.ts`: `tools/list` responds; stdout-purity (only JSON-RPC frames); every tool has description+schema+3 annotations; `readOnlyHint` tools stay inside the read allowlist; tarball G4–G6; bundle-size/forbidden-string gate.
- [ ] 9.2 GREEN `describeConformance({serverPath})` factory + `~120`-line `packages/mcp-testing/src/jsonrpc-client.ts` (raw newline-framed stream, not the SDK `Client`); spawn `node dist/server.js` with `stdio:['pipe','pipe','pipe']`, sanitized env; run against `packages/fixture-server`.
- [ ] 9.3 Wire conformance as a blocking `turbo test` step (`dependsOn:["^build"]`) so CI fails on regression from day one.
- [ ] 9.4 RED: conformance case — a fixture-server tool that shells out via the allowlisted executor; assert stdout stays pure JSON-RPC despite the child inheriting fd 1 (closes the threat-matrix "subprocess stream integrity" case end-to-end).
- [ ] 9.5 GREEN: shared synthetic `packages/mcp-testing/src/fixtures/catalog-views.csv` + `synthetic-identifiers.ts` (synthetic org/site/domain constants) consumed by both fixture-server and future domain packages.

## Phase 10: Client-Boundary Lint (fixture-proven for packages that don't exist yet)

- [ ] 10.1 RED `packages/mcp-core/eslint-fixtures/deep-client-import-violation.ts`: imports `.../client/internal-helper` instead of `client/index`.
- [ ] 10.2 GREEN: `no-restricted-imports` boundary block in `eslint.config.js` scoped to `packages/*/src/{adapters,tools}/**`.
- [ ] 10.3 RED `packages/mcp-core/eslint-fixtures/missing-license-header.ts`.
- [ ] 10.4 GREEN: license-header eslint rule (Apache-2.0 header); extend 2.11's programmatic test to assert all three fixture rule IDs (boundary, SDK-barrel, license-header) fire.

## Phase 11: Server Manifest, Template & Generator

- [ ] 11.1 Define `schema/servers.schema.json` — required per entry: `id, package, bin, version, domain, status, description, tools[]` (each tool: `name, readOnly, description`); optional: `requires:{binaries:string[], env:string[]}`, `docs` (reconciles the proposal's example fields with the design's manifest shape).
- [ ] 11.2 RED: schema-validation test — a valid entry passes; an entry missing `description` fails and names the field.
- [ ] 11.3 GREEN: create root `servers.json` (`{"servers":[]}` initially).
- [ ] 11.4 Build `templates/server/**` (package.json, tsconfig, entrypoint using `mcp-core` bootstrap + `defineTool`, one template test) — must pass conformance unmodified.
- [ ] 11.5 RED `scripts/new-server.test.mjs`: re-running `new-server` on an existing package name fails without overwriting.
- [ ] 11.6 GREEN `scripts/new-server.mjs`: copies template, substitutes `__NAME__/__DOMAIN__/__BIN__`, appends `servers.json`, regenerates README; wire `pnpm new-server`.
- [ ] 11.7 Regenerate `packages/fixture-server` FROM `templates/server/` (retiring Phase 2's throwaway version); add CI step asserting byte-equality on regeneration.
- [ ] 11.8 RED: README-staleness test — edit `servers.json`, leave `README.md` stale, `scripts/gen-readme.mjs --check` exits 1 with a diff.
- [ ] 11.9 GREEN `scripts/gen-readme.mjs`: renders between `<!-- servers:start -->`/`<!-- servers:end -->`; `--check` re-runs the same code path in memory and diffs against the committed file (single implementation, cannot drift); wire as a CI step.

## Phase 12: Release Pipeline

- [ ] 12.1 `.changeset/config.json`: independent versioning, `access:public`, `provenance:true`, `@hiberus-magento` scope.
- [ ] 12.2 `.github/workflows/ci.yml`: install → lint → typecheck → test → build → `verify:package` → conformance → license-allowlist → secret-scan, `ubuntu-latest`, fails on any step.
- [ ] 12.3 `.github/workflows/release.yml`: `changeset publish`, `permissions:{id-token:write,contents:write}`, OIDC trusted publishing preferred; document scoped `NPM_TOKEN` fallback as a temporary deviation.
- [ ] 12.4 RED `scripts/check-licenses.test.mjs`: a `GPL-3.0` dependency fails, naming package + license.
- [ ] 12.5 GREEN `scripts/check-licenses.mjs`: allowlist `MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD`; wire as CI step.
- [ ] 12.6 Add secret-scanning CI step over the diff; RED fixture with a credential-shaped string, GREEN step fails and reports file+line.
- [ ] 12.7 RED: missing `THIRD-PARTY-NOTICES.txt` fails the build/license check.
- [ ] 12.8 GREEN: per-package `THIRD-PARTY-NOTICES.txt` generator listing resolved licenses, reproducing any bundled Apache-2.0 dependency's NOTICE verbatim.
- [ ] 12.9 Verify `changesets publish --dry-run` succeeds locally — no real npm publish in this change.

## Phase 13: Governance & Synthetic-Data Audit

- [ ] 13.1 Root `LICENSE` (Apache-2.0 full text).
- [ ] 13.2 `CONTRIBUTING.md`, `CODEOWNERS`, `AGENTS.md`.
- [ ] 13.3 Audit every fixture/example/sample repo-wide against `synthetic-identifiers.ts` (9.5); replace any accidental real-looking identifier; add a CI grep step over `packages/**/fixtures/**` and `**/*.example.*` that fails on a banned real-identifier pattern list.

## Phase 14: Closeout & Verification

- [ ] 14.1 Flip `openspec/config.yaml` `testing.status` → `implemented`; populate `projects: [mcp-core, mcp-testing, fixture-server]`.
- [ ] 14.2 Full clean-clone run on Node 22: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:package` — all green.
- [ ] 14.3 Walk every checkbox in `proposal.md` Success Criteria and confirm each is satisfied.
