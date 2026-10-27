# Tasks: aem-sites-package

Strict TDD: every GREEN task follows a RED task that fails for the right reason. Synthetic
identifiers only (`packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`). First task of
Phase 1: add `SYNTHETIC_AEM_AUTHOR` (an all-zero program/environment author host) and a synthetic
content root there, and teach `scripts/audit-synthetic-identifiers.mjs` to accept exactly that
host — AEM Cloud author hosts carry program ids, so the bare vendor domain is not enough.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,000–4,000 |
| Delivery strategy | exception-ok |
| Touches packages other than `aem-sites` | `mcp-testing` (synthetic ids) and the audit script only; `eds` untouched |

## Phase 0: Baseline

- [ ] 0.1 Branch `feat/aem-sites-package` from `main`.
- [ ] 0.2 `pnpm install && pnpm build && pnpm test` green.
- [ ] 0.3 Spike (no code merged): confirm against a non-production author — `Deactivate`, `copyPage`/`movePage`/`deletePage`, `cq:robotsTags` rendering in EDS. Record in `exploration.md`; update the `unverified` markers.

## Phase 1: Scaffold

- [ ] 1.1 `pnpm new-server aem-sites --domain aem-sites --description "AEM as a Cloud Service Sites author client — CLI and MCP server."`
- [ ] 1.2 Conformance and packaging gates green on the empty scaffold.

## Phase 2: Client and guard

- [ ] 2.1 RED/GREEN `guard/paths.ts`: normalisation, write roots, forbidden roots (startup error).
- [ ] 2.2 RED/GREEN `guard/properties.ts`: allowlist, `AEM_EXTRA_PROPERTIES`, `@`/`:` ban (property-based tests).
- [ ] 2.3 RED/GREEN `client/http.ts`: host pinning, `redirect: "manual"`, retry policy (D7), CSRF.
- [ ] 2.4 RED/GREEN reads: `queryPages` (pagination), `readPage`, `readSheet`, `readReplicationStatus`, `listTemplates`, `readPageTree` — projected.
- [ ] 2.5 RED/GREEN builders: properties, robots, sheet upsert/delete, replicate, wcmcommand.
- [ ] 2.6 RED/GREEN `confirm/`: plan store (TTL, one-time, bound to env+kind+requests), fingerprint, protected-pattern matcher.

## Phase 3: Credentials

- [ ] 3.1 RED/GREEN `credential-provider.ts`: one `StaticTokenProvider` per env, `AEM_TOKEN_<ENV>` → `aem-sites-<env>.json` (0600); env names `[a-z0-9]+`.
- [ ] 3.2 RED/GREEN token normalisation: Developer Console JSON (`accessToken`) and `Bearer ` prefix, as `eds aem auth token set`.
- [ ] 3.3 RED/GREEN `AemAuthError` on 401 / 3xx / HTML login with the `auth token set --env` remedy; token re-read per call.

## Phase 4: MCP surface

- [ ] 4.1 RED/GREEN eight read tools.
- [ ] 4.2 RED/GREEN `aem_plan` Phase-1 kinds: `page.set-properties`, `page.set-robots`, `sheet.upsert-row`, `sheet.delete-row`, `page.publish`, `page.unpublish`.
- [ ] 4.3 RED/GREEN `aem_apply`: token matrix (missing/forged/expired/reused/stale) × every kind; echoes; `confirmTarget`.
- [ ] 4.4 RED/GREEN protected envs/paths and `AEM_ALLOW_PROTECTED_PUBLISH`.
- [ ] 4.5 RED/GREEN Phase-2 kinds: `page.create`, `page.copy`, `page.move`, `page.delete` (refuses published).

## Phase 5: CLI, docs, manifest

- [ ] 5.1 CLI: `auth token set --env` (stdin only) `| clear --env | status` (QueryBuilder probe), `pages list`, `plan`, `apply` (reuses tools, `--yes`).
- [ ] 5.2 `servers.json` entry (env contract + tools), `node scripts/gen-readme.mjs`.
- [ ] 5.3 `docs/aem-sites-onboarding.md`: credentials, env vars, per-client "always ask" for `aem_apply`, composing with `eds` (noindex recipe).
- [ ] 5.4 Changeset `@hiberus-magento/aem-sites` 0.1.0.

## Phase 6: Live validation (non-production author)

- [ ] 6.1 Site-wide noindex via `sheet.upsert-row` → `page.publish` → `eds_plan` `/metadata.json`; check `<meta name="robots">` on `*.aem.page` and `*.aem.live`.
- [ ] 6.2 Per-page `page.set-robots` → publish → check rendering (closes Open Question 1).
- [ ] 6.3 `page.unpublish` removes the page from EDS live.
- [ ] 6.4 Create → copy → move → unpublish → delete round trip.
- [ ] 6.5 `verify-report.md`; drop `unverified` markers that passed.
