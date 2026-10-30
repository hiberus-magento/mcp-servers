# Tasks: aem-sites-batch

## Phase 1: Store and schema

- [x] 1.1 `PlanStore.put(plan, { ttlMs })` per-plan TTL; sweep by each entry's own expiry.
- [x] 1.2 `batch` and `page.publish-tree` in the schema; a batch never nests (mcp.test.ts).

## Phase 2: Plan and apply

- [x] 2.1 `staticCheck` per operation (builders + protected publish), rejection names the operation; one confirmation; `BATCH_TTL_MS`.
- [x] 2.2 `applyBatch`: plan each operation at its turn, skip no-ops, stop at the first rejection or failure, per-operation results.
- [x] 2.3 `page.publish-tree` with prefix re-check and 100-page chunks (fake author lists by prefix like QueryBuilder).
- [x] 2.4 CLI output for batch results.
- [x] 2.5 Read-after-write: a batch operation rejected as `not-found` is re-planned up to 5 times, 2 s apart (observed 2026-10-30: a page created by one operation was not found by the next).

- [x] 2.6 Progress: with a client `progressToken`, `notifications/progress` before each operation and after each request (total = operations, growing only); a failed notification never stops the batch. `ToolContext.reportProgress` in `mcp-core` (observed in 4.1: the client dropped a 45-minute apply after 30 minutes without progress).

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, spec `aem-sites-mcp` (Batches, Tree Publish, kinds).

## Phase 4: Live validation

- [x] 4.1 On a non-production author: rebuild a vertical with one batch.
  - 2026-10-30, a non-production author: a first batch (deletes, language-master live copies, sheets) stopped at a page create read back too early (`not-found`, fixed by 2.5); a second batch of 91 operations (pages, configuration references, 20 live copies, 40 sheet copies, 2 rows, 20 tree publishes) ran in about 45 minutes with one confirmation. The client gave up after 30 minutes without progress while the server kept applying to the end: a long batch should report progress.
