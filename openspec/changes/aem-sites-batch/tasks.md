# Tasks: aem-sites-batch

## Phase 1: Store and schema

- [x] 1.1 `PlanStore.put(plan, { ttlMs })` per-plan TTL; sweep by each entry's own expiry.
- [x] 1.2 `batch` and `page.publish-tree` in the schema; a batch never nests (mcp.test.ts).

## Phase 2: Plan and apply

- [x] 2.1 `staticCheck` per operation (builders + protected publish), rejection names the operation; one confirmation; `BATCH_TTL_MS`.
- [x] 2.2 `applyBatch`: plan each operation at its turn, skip no-ops, stop at the first rejection or failure, per-operation results.
- [x] 2.3 `page.publish-tree` with prefix re-check and 100-page chunks (fake author lists by prefix like QueryBuilder).
- [x] 2.4 CLI output for batch results.

## Phase 3: Docs

- [x] 3.1 `aem_plan` description, README, spec `aem-sites-mcp` (Batches, Tree Publish, kinds).

## Phase 4: Live validation

- [ ] 4.1 On a non-production author: rebuild a vertical with one batch.
