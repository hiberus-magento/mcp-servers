# Tasks: aem-sites-rollout-configs

## Phase 1: Client

- [x] 1.1 `buildSetRolloutConfigs`: Sling POST to `<path>/jcr:content/cq:LiveSyncConfig`, `cq:rolloutConfigs` as `String[]`, allowlist and write roots (builders.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `livecopy.set-rollout-configs` in the schema, `draftSetRolloutConfigs` (Live Copy root required, `no-changes` for the same list, `page` state check, Push on modify warning), batch static check.
- [x] 2.2 Fake author updates `cq:LiveSyncConfig` on that POST; token matrix case (plan-apply.test.ts).

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, `servers.json`, spec `aem-sites-mcp` (Live Copies).

## Phase 4: Live validation

- [x] 4.1 On a non-production author: set Standard + Push on modify on one store Live Copy root, read it back with `aem_get_page`, change a field of its source and check the store page without a manual rollout; then roll out from the level above and record whether the store page changes too.
  - 2026-11-03, a non-production author: one store Live Copy root got Standard + Push on modify and read back with both configs. An author edited a global language master page and rolled it out to its vertical copy by hand; the store page under that vertical copy changed on its own, with no rollout to it. So a write made by a rollout counts as a modification for a downstream Push on modify, and a three-level tree needs one manual rollout per change. Then 62 more store roots were set in two batches (19 and 43 operations), all applied.
