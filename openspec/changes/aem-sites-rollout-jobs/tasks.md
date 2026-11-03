# Tasks: aem-sites-rollout-jobs

## Phase 1: Jobs

- [x] 1.1 `createJobRegistry`: issues ids, keeps at most 500 jobs (jobs.test.ts).
- [x] 1.2 `jobStatus`: reads each target's `cq:lastRolledout`, `completed` / `running` / `unknown-job` (jobs.test.ts).

## Phase 2: Plan / apply

- [x] 2.1 `livecopy.rollout` takes `wait`; the plan says whether apply waits (plan-apply.test.ts).
- [x] 2.2 Without `wait`, apply returns `accepted` with the job and no polling; a batch records the job per operation and goes on (plan-apply.test.ts).
- [x] 2.3 With `wait`, apply polls up to 15 minutes with progress; a single plan returns `accepted` with the pending targets on timeout, a batch stops keeping the job (plan-apply.test.ts).

## Phase 3: Tool

- [x] 3.1 `aem_get_job_status`, read-only, eleven tools (mcp.test.ts).

## Phase 4: Docs

- [x] 4.1 `aem_plan` / `aem_apply` descriptions, README, `servers.json`, spec `aem-sites-mcp` (Live Copies), changeset.

## Phase 5: Live validation

- [ ] 5.1 On a non-production author: a batch of shallow rollouts, one per language, each to its vertical targets, under one confirmation; `aem_get_job_status` until every job is `completed`. Record the body of the `/bin/asynccommand` response.
