# Proposal: aem-sites-rollout-jobs — rollouts that return when AEM accepts them

## Intent

Observed on 2026-11-03 on a non-production author, bringing a new folder from the global language
master to the vertical language masters with one shallow rollout per language:

1. `aem_apply` sends `POST /bin/asynccommand` and then waits up to 5 minutes for every target's
   `cq:lastRolledout` to change. The jobs took about 7 minutes, so every apply returned `failed`
   ("accepted but has not reached … after 300 s") although every rollout finished.
2. Each apply blocked for 5 minutes, so the plans the user had confirmed in a row expired before
   their turn (`rejected: expired` from the third one on).
3. Inside a `batch`, a rollout that ran out of time stopped the whole batch.
4. Once a job was accepted there was no way to ask whether it had reached its targets.

## Scope

### In Scope

- `livecopy.rollout` gains `wait?: boolean` (default `false`).
  - `wait: false`: apply returns as soon as the author accepts the request. A single plan returns
    `status: "accepted"` with one `jobs` entry per rollout; a batch records the job on the
    operation and goes on with the next one.
  - `wait: true`: apply waits, as before, until every target's `cq:lastRolledout` differs from its
    plan-time value, now for up to 15 minutes and reporting progress while it waits. If time runs
    out, a single plan still returns `accepted` (the author took the job; it is not a failure),
    with the targets not reached yet. A batch stops there, because the operations after it were
    chained on that rollout; the result keeps the job so it can be checked.
- Rollout jobs: the server records each accepted rollout in memory (env, source, targets, their
  `cq:lastRolledout` at plan time, accepted at, the author's response excerpt) under an id it
  issues. The format of the author's response to `/bin/asynccommand` is not known to this
  repository yet, so the id is the server's own; the response is kept so the live validation can
  record its shape.
- `aem_get_job_status { jobId }` (read-only): reads each target's `cq:lastRolledout` and reports
  `completed` (every target reached) or `running`, with the targets reached and pending, and the
  time since the job was accepted. An unknown id (server restarted, or never issued) answers
  `unknown-job` and points at `aem_get_page` on the targets.
- Several rollouts under one plan and one confirmation: a `batch` of `livecopy.rollout`
  operations, each with its own targets. Without `wait`, it applies in seconds and returns every
  job, so it no longer depends on the plan TTL.

### Out of Scope

- AEM's own async-job API (job id, status, failure reason). Not used until a live validation
  records the response of `/bin/asynccommand` and the endpoint that reports a job.
- Cancelling a rollout job.
- Persisting jobs across server restarts.

## Risks

| Risk | Mitigation |
|---|---|
| A batch chains a lower-level rollout on one that has not finished | `wait: true` on the rollouts that later operations depend on; the plan for a batch says which rollouts do not wait |
| A model reads `accepted` as done | The result says the job is running and names `aem_get_job_status`; the tool description says so |
| A job never reaches a target (not a Live Copy of the source, or the job failed) | `aem_get_job_status` keeps reporting it pending with the elapsed time |
| Memory grows with jobs | At most 500 jobs kept, oldest dropped first |

## Rollback

Revert the change: `livecopy.rollout` goes back to waiting 5 minutes and `aem_get_job_status`
disappears. No state outside the server's memory is involved.

## Success Criteria

- [ ] Plan/apply, batch and tool tests for `wait`, `accepted` and `aem_get_job_status`.
- [ ] Validated on a non-production author: one batch of shallow rollouts, one per language, each
  to several vertical targets, applied in one confirmation; every job reported `completed` by
  `aem_get_job_status`.
