# Tasks: aem-sites-rollout-configs

## Phase 1: Client

- [x] 1.1 `buildSetRolloutConfigs`: Sling POST to `<path>/jcr:content/cq:LiveSyncConfig`, `cq:rolloutConfigs` as `String[]`, allowlist and write roots (builders.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `livecopy.set-rollout-configs` in the schema, `draftSetRolloutConfigs` (Live Copy root required, `no-changes` for the same list, `page` state check, Push on modify warning), batch static check.
- [x] 2.2 Fake author updates `cq:LiveSyncConfig` on that POST; token matrix case (plan-apply.test.ts).

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, `servers.json`, spec `aem-sites-mcp` (Live Copies).

## Phase 4: Live validation

- [ ] 4.1 On a non-production author: set Standard + Push on modify on one store Live Copy root, read it back with `aem_get_page`, change a field of its source and check the store page without a manual rollout; then roll out from the level above and record whether the store page changes too.
