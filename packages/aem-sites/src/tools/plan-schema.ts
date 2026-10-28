// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_plan` / `aem_apply` input schemas (aem-sites-package design.md, D1).
// One discriminated union on `kind`, nested under `operation` because
// `defineTool` needs a top-level `ZodObject`. Every branch is `.strict()`,
// so a field a kind does not take is a schema rejection, never ignored.
// The schema only shapes the input; the write guard (paths, property names,
// operators) runs when requests are built, so it cannot be skipped by a
// schema change.
import { z } from "zod";
import { ALLOWED_ROBOTS_TOKENS } from "../guard/properties.js";

/** At most 100 targets per plan, like `eds`'s planned paths. */
export const plannedPaths = z.array(z.string().min(1)).min(1).max(100);

const propertyValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const target = z.enum(["preview", "publish", "both"]);
const sheetMatch = z.object({ column: z.string().min(1), value: z.string() }).strict();

const operationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("page.set-properties"),
      path: z.string().min(1),
      set: z.record(z.string(), propertyValue).optional(),
      remove: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("page.set-robots"),
      paths: plannedPaths,
      /** `null` removes `cq:robotsTags`. */
      robots: z.array(z.enum(ALLOWED_ROBOTS_TOKENS as unknown as [string, ...string[]])).min(1).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sheet.upsert-row"),
      sheetPath: z.string().min(1),
      /** The row whose `column` equals `value` is updated; if none, a row is added. */
      match: sheetMatch,
      values: z.record(z.string(), z.string()),
    })
    .strict(),
  z.object({ kind: z.literal("sheet.delete-row"), sheetPath: z.string().min(1), match: sheetMatch }).strict(),
  z.object({ kind: z.literal("page.publish"), paths: plannedPaths, target }).strict(),
  z.object({ kind: z.literal("page.unpublish"), paths: plannedPaths, target }).strict(),
  z
    .object({
      kind: z.literal("page.create"),
      parentPath: z.string().min(1),
      name: z.string().min(1),
      title: z.string().min(1),
      template: z.string().min(1),
      properties: z.record(z.string(), propertyValue).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("page.copy"),
      srcPath: z.string().min(1),
      destParentPath: z.string().min(1),
      destName: z.string().min(1).optional(),
      shallow: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("page.move"), srcPath: z.string().min(1), destParentPath: z.string().min(1), destName: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal("page.delete"), path: z.string().min(1) }).strict(),
]);

export type PlanOperation = z.infer<typeof operationSchema>;
export type OperationKind = PlanOperation["kind"];

export const OPERATION_KINDS: readonly OperationKind[] = operationSchema.options.map((option) => option.shape.kind.value);

export const aemPlanInput = z.object({ env: z.string().min(1), operation: operationSchema }).strict();
export type AemPlanInput = z.infer<typeof aemPlanInput>;

/**
 * A token plus two echoes of the plan. The operation cannot be restated, so
 * it cannot be altered; `env` and `kind` must equal the plan's, and exist so
 * a client's approval dialog shows what is being approved.
 */
export const aemApplyInput = z
  .object({
    token: z.string().min(1),
    env: z.string().min(1),
    kind: z.enum(OPERATION_KINDS as readonly [OperationKind, ...OperationKind[]]),
    confirmTarget: z.string().min(1).optional(),
  })
  .strict();
export type AemApplyInput = z.infer<typeof aemApplyInput>;
