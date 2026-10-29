# Proposal: aem-sites-batch — many operations under one confirmation

## Intent

Rebuilding a vertical on a non-production author took about sixty confirmations on 2026-10-29: one
plan per operation, several that could not share a confirmation because each re-checks the state
the previous one changed, and publish plans of 100 pages that expired while earlier ones were still
applying (a token lives 10 minutes; one 100-page publish takes about 1.5 minutes). The next
vertical has the same shape: deletes, Live Copies, copied sheets, a Cloud Configuration per store,
rows and a publish of about 1700 pages.

## Scope

### In Scope

- `kind: "batch"` with 1–300 operations of the other kinds (no nesting).
  - Plan time: the builders' guards and the protected-publish rule per operation, no reads; a
    rejection names the operation. One confirmation lists every operation and warns that requests
    are planned at apply time. Protected targets still need the typed confirmation.
  - The token lives 60 minutes (per-plan TTL in the plan store).
  - Apply: each operation is planned against the state when its turn comes, then sent; nothing to
    change is skipped; the first rejection or failed request stops the batch. The result reports
    per operation (summary, requests sent and succeeded), never every request.
- `page.publish-tree { root, target }`: every page at or below the root, listed when planned,
  replicated in chunks of 100 like `page.publish`.

### Out of Scope

- Rolling back a partly applied batch.
- Batches across environments or MCP servers.

## Risks

| Risk | Mitigation |
|---|---|
| The user approves operations, not exact requests | Every operation is listed with its target and options; the warning says requests are planned at apply time; every guard and published-content check still runs per operation |
| State changes between approval and apply | Each operation is planned at its turn, so it sees the current state; stale reads cannot apply |
| A long batch fails half way | It stops at the first failure and reports what ran; each operation is idempotent enough to re-plan the rest |

## Success Criteria

- [ ] Schema, plan, apply and token-matrix tests for `batch`; prefix test for `page.publish-tree`.
- [ ] Validated on a non-production author: a vertical rebuilt with one batch.
