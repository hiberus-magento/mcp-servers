# Tasks: eds-write-surface

Strict TDD throughout: every GREEN task is preceded by a RED task whose test fails for the right
reason. All fixtures use the synthetic identifiers in
`packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2,500–3,500 (client operations, plan store, tools, tests, docs) |
| 400-line budget risk | High |
| Delivery strategy | exception-ok (per `openspec/config.yaml`) |
| Touches packages other than `eds` | No |

Decision needed before apply: No (open questions in design.md do not block the RED phase)

### Suggested Work Units

| Unit | Goal | Focused test command | Rollback boundary |
|------|------|----------------------|-------------------|
| 1 | Client operations (Phase 2) | `pnpm --filter @hiberus-magento/eds test` | new files under `client/operations/`; `site-config.ts` revert |
| 2 | Plan store (Phase 3) | same | `confirm/` is net-new |
| 3 | Tools and surface (Phase 4) | same | `tools/` and `mcp.ts` revert |
| 4 | Docs, manifest, release (Phase 5) | `node scripts/gen-readme.mjs --check` | docs and manifest revert |

## Phase 0: Baseline

- [x] 0.1 `pnpm install && pnpm build && pnpm test` green on `feat/eds-write-surface` before any change.
  Build green; `eds` 170/170, `aco` 249/249, `magento-cloud` 385/385, `mcp-core` and
  `fixture-server` green. Pre-existing timing flakes under machine load (not caused by this change,
  outside `packages/eds`): `mcp-testing` stdout-purity positive control (2 s wait for a grandchild
  process) and `magento-cloud` 75 ms cold-start CPU budget. Both pass when run alone.
- [x] 0.2 Client behaviour matrix: for Claude Code, GitHub Copilot (VS Code) and opencode, record whether a `destructiveHint: true` tool prompts by default and how to force "always ask" for one tool. Result feeds 5.3.
  See `client-matrix.md`: no client reads `destructiveHint`; each needs an explicit per-tool rule.

## Phase 1: Spec review

- [ ] 1.1 Review proposal, design and deltas with the package owner (CODEOWNERS) before Phase 2.
  Pre-review done 2026-10-27 against code and the OpenAPI contract. D1–D3 accepted 2026-10-27 and
  applied to the `eds-mcp` and `eds-cli` deltas and to 2.8b, 4.1, 4.15 and 4.16. **CODEOWNERS
  sign-off still pending.**
- [x] 1.2 Resolve or explicitly defer each design.md open question.
  AEM heuristic, plan lifetime, org config, client matrix and apply replay resolved; config
  versions and the secrets round-trip deferred to Phase 6; D1–D3 decided (design.md, "Decided 2026-10-27").

## Phase 2: Client (`packages/eds/src/client/`)

- [ ] 2.1 RED: `createSite` — GET 404 → PUT; GET 200 → error, no PUT. GREEN: replace `putSiteConfig`.
- [ ] 2.2 RED: `updateSiteConfig` — GET 200 → POST; GET 404 → error, no POST. GREEN.
- [ ] 2.3 RED: `listSites` (both response shapes), `deleteSite`. GREEN.
- [ ] 2.4 RED: `listConfigVersions`, `restoreConfigVersion` (query parameter). GREEN.
- [ ] 2.5 RED: `getRobots` (text), `setRobots` (`text/plain` body). GREEN.
- [ ] 2.6 RED: preview single update/delete and bulk with explicit body + `delete: true`; ignored paths reported. GREEN: `preview.ts`.
- [ ] 2.7 RED: live single publish/unpublish beside the existing bulk. GREEN.
- [ ] 2.7b RED: bulk live sends `{ paths }` to publish and `{ paths, delete: true }` to unpublish, never `state` (contract body has no `state` field; defect in shipped `setLiveState`). GREEN: fix `live.ts` and its test.
- [ ] 2.8 RED: index single update/delete. GREEN.
- [ ] 2.8b RED: bulk index sends exactly `{ paths }`, with no `scope`; full-site sends `POST /index/{org}/{site}/{ref}/*` with no body (design.md D1). GREEN: rewrite `reindex` in `index-ops.ts` and its test.
- [ ] 2.9 RED: `purgeCache` per path, `rebuildSitemap`. GREEN: `cache.ts`, `sitemap.ts`.
- [ ] 2.10 RED: code status/sync/delete keyed by owner/repo, path `/code/{owner}/{repo}/{ref}/{path}`. GREEN: `code.ts`; add the missing `{ref}` segment to `codePath`.
- [ ] 2.11 RED: `listJobs`, `stopJob` (any 2xx). GREEN.
- [ ] 2.12 RED: `listApiKeys` (org-level) returns metadata only; `deleteApiKey` (used by the CLI only, D2); source scan asserts no key-creating function is exported. GREEN: `api-keys.ts`.
- [ ] 2.13 Export every new function from `client/index.ts`; extend the existing exports test.
- [ ] 2.14 Purity test still passes over the enlarged `client/` tree.
- [ ] 2.15 RED: `sendPlannedRequest` accepts only `POST`/`PUT`/`DELETE`, sends method, path, body and content type unchanged, and rejects `GET`. GREEN: export from `client/index.ts` (design.md, Open Questions, "How `eds_apply` replays requests").

## Phase 3: Plan store (`packages/eds/src/confirm/`)

- [ ] 3.1 RED: token is ≥ 32 random bytes, base64url, never derived from plan contents. GREEN: `plan-store.ts`.
- [ ] 3.2 RED: expiry at 10 minutes under an injected clock. GREEN.
- [ ] 3.3 RED: consume-once; second lookup reports `used`. GREEN.
- [ ] 3.4 RED: 101st plan evicts expired then oldest. GREEN.
- [ ] 3.5 RED: canonical JSON is key-order independent; SHA-256 fingerprint. GREEN: `fingerprint.ts`.
- [ ] 3.6 RED: RFC 7386 appendix examples; `null` removes; arrays replaced; non-object patch rejected. GREEN: `merge-patch.ts`.
- [ ] 3.7 RED: JSON Pointer diff lists exactly the changed keys with before/after. GREEN.
- [ ] 3.8 RED: protected-site patterns — `*` wildcard, anchoring, case sensitivity, `.`/`+` literal. GREEN: `protected-sites.ts`.

## Phase 4: Tools (`packages/eds/src/tools/`, `mcp.ts`)

- [ ] 4.1 RED: operation union accepts exactly the 22 kinds; strict branches; `key.create`, `key.delete` and unknown kinds rejected; `code.*` rejects `owner`/`repo`; `index.full-site` requires literal `confirmFullReindex: true`, records a bodyless `POST …/*` and warns; `index.update` records exactly `{ paths }`; `paths` non-empty and ≤ 100. GREEN: `plan.ts` schemas and builders.
- [ ] 4.2 RED: `eds_plan` issues only reads for every kind (fetch double records no write). GREEN: plan builders per kind.
- [ ] 4.3 RED: config plan returns `changes`, fingerprint, `previousVersionId`; empty diff → `no-changes`, no token. GREEN.
- [ ] 4.4 RED: every planned result carries `instruction`, non-empty `confirmationMessage`, `requests`, `warnings`. GREEN: message assembly.
- [ ] 4.5 RED: AEM warning present for `preview.*`/`live.*` on a `markup` source whose URL contains `/bin/franklin.delivery`, absent otherwise (including a `markup` source with another URL). GREEN.
- [ ] 4.5b RED: a `config.patch` plan on a document with a non-empty `secrets` or `tokens` key carries a warning naming them. GREEN.
- [ ] 4.6 RED: `code.*` resolves owner/repo from the site's `code` block and shows it in the message. GREEN.
- [ ] 4.7 RED: plan output redacts a secret-shaped value from the site document. GREEN.
- [ ] 4.8 RED (write gate): for every kind, `eds_apply` with missing, forged, expired, reused and stale token issues zero writes. GREEN: `eds_apply`.
- [ ] 4.9 RED: applied write requests equal the recorded requests byte for byte. GREEN.
- [ ] 4.10 RED: stale `config.patch` and `site.create` rejected with `stale-plan`, no write. GREEN.
- [ ] 4.11 RED: protected site — missing/mismatched `confirmSite` rejected without consuming the token; correct `confirmSite` then succeeds. GREEN; `mcp.ts` reads `EDS_PROTECTED_SITES`.
- [ ] 4.12 RED: `eds_apply` rejects extra fields (`site`, `operation`). GREEN.
- [ ] 4.13 RED: `wait: true` on a job-backed kind returns the final job. GREEN.
- [ ] 4.14 RED: no apply path produces `status: "pending"`. GREEN.
- [ ] 4.15 RED: new read tools — `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`, `eds_get_code_status` (repository resolved from site), `eds_list_jobs`, `eds_list_api_keys` (org-level; rejects a `site` field). GREEN.
- [ ] 4.16 RED: `tools/list` is exactly the fourteen names with the annotation triples in the spec; removed tools absent; `eds_apply` has `_meta["anthropic/requiresUserInteraction"] === true` and no other tool has the key (D3). GREEN: remove `eds_set_live_state`, `eds_reindex`, `eds_manage_snapshot`; pass `_meta` in `mcp.ts`'s registration of `eds_apply`.
- [ ] 4.17 Conformance suite passes against the rebuilt bundle; cold-start budget still met.

## Phase 5: Manifest, docs, release

- [ ] 5.1 `servers.json`: new tool list; every new write kind described under `eds_apply`'s `unverified` marker. Run `node scripts/gen-readme.mjs`.
- [ ] 5.2 `packages/eds/README.md`: plan/apply flow, operation kinds, `EDS_PROTECTED_SITES`, migration table for the three removed tools.
- [ ] 5.3 `docs/eds-onboarding.md`: per-client "always ask for `eds_apply`" settings from 0.2 (`client-matrix.md`); note that Claude Code prompts without configuration because of `requiresUserInteraction`.
- [ ] 5.4 Changeset: minor bump of `@hiberus-magento/eds`. Mention the bulk-unpublish body fix (2.7b): `0.1.x`'s `eds_set_live_state` with `unpublished` did not send `delete: true`.
- [ ] 5.5 All `AGENTS.md` gates: lint, typecheck, test, build, `verify:package`, `gen-readme --check`, `check-licenses`, `audit-synthetic-identifiers`.

## Phase 6: Manual validation (outside CI, against a real non-production tenant)

- [ ] 6.1 Reads: every read tool against one non-production site.
- [ ] 6.2 `config.patch` → apply → verify → `version.restore` → verify. Record whether the `POST` created a new entry in `versions.json`.
- [ ] 6.2b On a throwaway site with a secret set, check whether `GET` returns the secret masked and whether a `config.patch` round-trip preserves it. If it does not, block `config.patch` on such documents before publish.
- [ ] 6.3 `robots.set` and back.
- [ ] 6.4 `preview.update` → `live.publish` → `live.unpublish` on a test page; AEM warning shown when applicable.
- [ ] 6.5 `site.create` → `site.delete` of a throwaway site.
- [ ] 6.6 Negative: apply without asking is not attempted by the model; reused, expired and stale tokens; protected site without `confirmSite`.
- [ ] 6.7 Repeat 6.2 and 6.6 in Claude Code, GitHub Copilot and opencode.
- [ ] 6.8 Remove the `unverified` marker only for the kinds actually exercised.
