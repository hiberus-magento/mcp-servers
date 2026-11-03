# Tasks: aem-sites-rollout

## Phase 1: Client

- [x] 1.1 `buildRollout` with the console's async rollout fields; targets inside the write roots, not inside or above the source (builders.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `livecopy.rollout` in the schema, `draftRollout` (source and targets must exist; reads each target's `cq:lastRolledout`), batch static check.
- [x] 2.2 `PlannedStep.awaitRollout`: apply polls the targets until `cq:lastRolledout` changes, fails after 5 min naming them; fake author stamps targets on a rollout POST (plan-apply.test.ts, token matrix case).

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, spec `aem-sites-mcp` (Live Copies).

## Phase 4: Live validation

- [x] 4.1 On a non-production author: roll out a global page to a vertical language master and that page to a store in one batch; the store page shows the source's change.
  - 2026-10-30, a non-production author: one batch changed a component field on 9 source pages, rolled each out to its vertical copies (9 rollouts, 21 targets), then each vertical page to its store copies (21 rollouts, 63 targets) and published the 63 pages: 40 operations, all applied in one call; every rollout reached its targets before the next started, and the store pages carry the source's value with their own paths (MSM rewrites the link per Live Copy).
