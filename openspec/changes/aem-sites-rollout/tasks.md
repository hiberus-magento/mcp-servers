# Tasks: aem-sites-rollout

## Phase 1: Client

- [x] 1.1 `buildRollout` with the console's async rollout fields; targets inside the write roots, not inside or above the source (builders.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `livecopy.rollout` in the schema, `draftRollout` (source and targets must exist; reads each target's `cq:lastRolledout`), batch static check.
- [x] 2.2 `PlannedStep.awaitRollout`: apply polls the targets until `cq:lastRolledout` changes, fails after 5 min naming them; fake author stamps targets on a rollout POST (plan-apply.test.ts, token matrix case).

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, spec `aem-sites-mcp` (Live Copies).

## Phase 4: Live validation

- [ ] 4.1 On a non-production author: roll out a global page to a vertical language master and that page to a store in one batch; the store page shows the source's change.
