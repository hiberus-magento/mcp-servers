# Tasks: aem-sites-msm

## Phase 0: Spike

- [x] 0.1 Read the Sites console's Live Copy wizard and lock actions on a non-production author.
- [x] 0.2 Try `createLiveCopy`, `lockPage`, `unlockPage` directly; record in `exploration.md`.

## Phase 1: Client and guard

- [x] 1.1 `buildCreateLiveCopy`, `buildLockPage` (builders.test.ts).
- [x] 1.2 Rollout-config allowlist + `AEM_EXTRA_ROLLOUT_CONFIGS` (paths.test.ts, config.test.ts).
- [x] 1.3 `readCurrentUser`; `readPage` reports `liveCopy` from `cq:LiveSyncConfig` (reads.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 Kinds `livecopy.create`, `page.lock`, `page.unlock` in the schema and plan builder.
- [x] 2.2 Token matrix for the three kinds; `locked-by-other`, no-op lock/unlock, Live Copy guards.

## Phase 3: Docs and manifest

- [x] 3.1 `servers.json` (`AEM_EXTRA_ROLLOUT_CONFIGS`, aem_plan description), package README,
  onboarding recipe.

## Phase 4: Live validation

- [x] 4.1 (2026-10-28, all HTTP 200, read back after each step) Through the MCP: `page.lock` → `page.unlock` on a test page; `livecopy.create` of a test
  page, read back as a Live Copy, then delete it.
