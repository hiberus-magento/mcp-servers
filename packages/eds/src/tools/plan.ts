// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `eds_plan` / `eds_apply` input schemas (eds-write-surface design.md,
// Decision 1). One discriminated union on `kind`, nested under `operation`
// because `defineTool` needs a top-level `ZodObject` — the same shape
// `eds_reindex` used. Every branch is `.strict()`, so a field a kind does not
// take (a model-supplied `owner` on `code.sync`, `paths` on
// `index.full-site`) is a schema rejection, never silently ignored.
//
// `key.create` and `key.delete` are deliberately absent (D2): API key writes
// stay CLI-only.
import { z } from "zod";

/** `paths` on every planned write: non-empty, at most 100, no empty entry (eds-mcp spec, "Bulk Write paths Is Non-Empty"). */
export const plannedPaths = z.array(z.string().min(1)).min(1).max(100);

const jsonObject = z.record(z.string(), z.unknown());
const snapshotId = z.string().min(1);

const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("config.patch"), patch: jsonObject }).strict(),
  z.object({ kind: z.literal("site.create"), config: jsonObject }).strict(),
  z.object({ kind: z.literal("site.delete") }).strict(),
  z.object({ kind: z.literal("version.restore"), versionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("robots.set"), content: z.string() }).strict(),
  z.object({ kind: z.literal("preview.update"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("preview.delete"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("live.publish"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("live.unpublish"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("index.update"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("index.delete"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("index.full-site"), confirmFullReindex: z.literal(true) }).strict(),
  z.object({ kind: z.literal("cache.purge"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("sitemap.rebuild"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("code.sync"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("code.delete"), paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("job.stop"), topic: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("snapshot.add"), id: snapshotId, paths: plannedPaths.optional() }).strict(),
  z.object({ kind: z.literal("snapshot.remove"), id: snapshotId, paths: plannedPaths }).strict(),
  z.object({ kind: z.literal("snapshot.publish"), id: snapshotId }).strict(),
  z.object({ kind: z.literal("snapshot.review"), id: snapshotId, reviewAction: z.enum(["approve", "reject"]), message: z.string().optional() }).strict(),
  z.object({ kind: z.literal("snapshot.delete"), id: snapshotId }).strict(),
]);

export type PlanOperation = z.infer<typeof operationSchema>;
export type OperationKind = PlanOperation["kind"];

export const OPERATION_KINDS: readonly OperationKind[] = operationSchema.options.map((option) => option.shape.kind.value);

export const edsPlanInput = z
  .object({
    site: z.string().min(1),
    /** Content, index, cache, sitemap, code and job kinds only; defaults to `main`. */
    ref: z.string().min(1).optional(),
    operation: operationSchema,
  })
  .strict();

export type EdsPlanInput = z.infer<typeof edsPlanInput>;

/**
 * A token plus two echoes of the plan. The operation itself cannot be
 * restated, so it cannot be altered (eds-mcp spec, "eds_apply Accepts Only a
 * Token"). `site` and `kind` must equal the plan's or nothing happens; they
 * exist so a client's approval dialog shows WHAT is being approved instead of
 * an opaque token (Phase 6 finding, 6.6).
 */
export const edsApplyInput = z
  .object({
    token: z.string().min(1),
    site: z.string().min(1),
    kind: z.enum(OPERATION_KINDS as readonly [OperationKind, ...OperationKind[]]),
    confirmSite: z.string().min(1).optional(),
    /** Block until a job-backed operation completes. Changes how the result is reported, never what is written. */
    wait: z.boolean().optional(),
  })
  .strict();

export type EdsApplyInput = z.infer<typeof edsApplyInput>;
