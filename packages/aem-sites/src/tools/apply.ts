// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_apply` (aem-sites-package design.md, D1, D5, D8). Accepts only a
// token: the requests it sends are the ones `aem_plan` stored, byte for
// byte. Before the first write it checks, in order, that the token is
// known, unexpired and unused, that the echoes match, that a protected plan
// carries the typed confirmation, and that the state the user reviewed has
// not changed. Only then is the token consumed and the first request sent.
import { AemError, readComponent, readPage, readSheet, type AemClient } from "../client/index.js";
import type { AemConfig } from "../config.js";
import { fingerprint } from "../confirm/fingerprint.js";
import type { PlanStore } from "../confirm/plan-store.js";
import { BATCH_READ_RETRIES, BATCH_READ_RETRY_MS, draftBatchOperation, rejectionFor, type PlannedStep, type StateCheck, type StoredPlan } from "./plan-builder.js";
import type { AemApplyInput, OperationKind, SinglePlanOperation } from "./plan-schema.js";

export type ApplyRejectionReason =
  | "unknown-token"
  | "expired"
  | "already-applied"
  | "env-mismatch"
  | "kind-mismatch"
  | "confirm-target-required"
  | "confirm-target-mismatch"
  | "stale-plan";

export interface StepResult {
  readonly label: string;
  readonly status: number;
}

/** One operation of a batch: what it did, without echoing every request. */
export interface BatchOperationResult {
  readonly index: number;
  readonly kind: SinglePlanOperation["kind"];
  readonly summary: string;
  readonly sent: number;
  readonly ok: number;
  /** The operation found nothing to change. */
  readonly skipped?: boolean;
}

export type ApplyResult =
  | { readonly status: "rejected"; readonly reason: ApplyRejectionReason; readonly message: string }
  | { readonly status: "applied"; readonly env: string; readonly kind: "batch"; readonly operations: readonly BatchOperationResult[] }
  | {
      readonly status: "failed";
      readonly env: string;
      readonly kind: "batch";
      /** Operations that completed before the failure; they are NOT rolled back. */
      readonly operations: readonly BatchOperationResult[];
      readonly failed: { readonly index: number; readonly kind: SinglePlanOperation["kind"]; readonly message: string; readonly sent: number };
      readonly notRun: number;
    }
  | { readonly status: "applied"; readonly env: string; readonly kind: OperationKind; readonly results: readonly StepResult[] }
  | {
      readonly status: "failed";
      readonly env: string;
      readonly kind: OperationKind;
      /** Requests that succeeded before the failure; they are NOT rolled back. */
      readonly completed: readonly StepResult[];
      readonly failed: { readonly label: string; readonly message: string };
      readonly notSent: number;
    };

export interface ApplyDeps {
  readonly config: AemConfig;
  readonly clientFor: (env: string) => AemClient;
  readonly store: PlanStore<StoredPlan>;
  readonly sleep: (ms: number) => Promise<void>;
}

const reject = (reason: ApplyRejectionReason, message: string): ApplyResult => ({ status: "rejected", reason, message });

function failureMessage(error: unknown, hints: PlannedStep["hints"]): string {
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof AemError && error.status !== undefined ? hints?.[error.status] : undefined;
  return hint !== undefined ? `${message}\n${hint}` : message;
}

async function stillHolds(client: AemClient, config: AemConfig, check: StateCheck): Promise<boolean> {
  switch (check.kind) {
    case "page": {
      const page = await readPage(client.http, check.path, config.extraProperties);
      return page !== undefined && fingerprint(page) === check.sha256;
    }
    case "page-present":
      return (await readPage(client.http, check.path, config.extraProperties)) !== undefined;
    case "page-absent":
      return (await readPage(client.http, check.path, config.extraProperties)) === undefined;
    case "component": {
      const component = await readComponent(client.http, check.path);
      return component !== undefined && fingerprint(component) === check.sha256;
    }
    case "sheet": {
      const sheet = await readSheet(client.http, check.path);
      return sheet !== undefined && fingerprint(sheet) === check.sha256;
    }
    case "sheet-absent":
      return (await readSheet(client.http, check.path)) === undefined;
  }
}

export async function applyPlan(deps: ApplyDeps, input: AemApplyInput): Promise<ApplyResult> {
  const lookup = deps.store.get(input.token);
  if (lookup.status !== "ok") {
    const message = {
      "unknown-token": "This token was never issued by this server (or the server restarted). Call aem_plan again.",
      expired: "This plan expired. Call aem_plan again and show the new plan to the user.",
      "already-applied": "This plan was already applied. Call aem_plan again for any further change.",
    }[lookup.status];
    return reject(lookup.status, message);
  }
  const plan = lookup.plan;
  if (input.env !== plan.env) {
    return reject("env-mismatch", `This token was planned for env "${plan.env}", not "${input.env}". Nothing was written; the token is still valid.`);
  }
  if (input.kind !== plan.kind) {
    return reject("kind-mismatch", `This token was planned for "${plan.kind}", not "${input.kind}". Nothing was written; the token is still valid.`);
  }
  if (plan.confirmTarget !== undefined) {
    if (input.confirmTarget === undefined) {
      return reject("confirm-target-required", `This plan touches a protected target: the user must type "${plan.confirmTarget}" and you must pass it as confirmTarget.`);
    }
    if (input.confirmTarget !== plan.confirmTarget) {
      return reject("confirm-target-mismatch", `confirmTarget does not match the protected target this plan touches. Nothing was written.`);
    }
  }

  const client = deps.clientFor(plan.env);
  for (const check of plan.checks) {
    if (!(await stillHolds(client, deps.config, check))) {
      deps.store.consume(input.token);
      return reject("stale-plan", `${check.path} changed after this plan was made. Nothing was written; call aem_plan again and show the new plan to the user.`);
    }
  }

  deps.store.consume(input.token);
  if (plan.batch !== undefined) {
    return applyBatch(deps, plan.env, plan.batch);
  }
  const completed: StepResult[] = [];
  for (const [index, step] of plan.steps.entries()) {
    if (step.pauseBeforeMs !== undefined) {
      await deps.sleep(step.pauseBeforeMs);
    }
    try {
      const response = await client.execute(step.request);
      completed.push({ label: step.request.label, status: response.status });
    } catch (error) {
      return {
        status: "failed",
        env: plan.env,
        kind: plan.kind,
        completed,
        failed: { label: step.request.label, message: failureMessage(error, step.hints) },
        notSent: plan.steps.length - index - 1,
      };
    }
  }
  return { status: "applied", env: plan.env, kind: plan.kind, results: completed };
}

/**
 * Runs an approved batch: each operation is planned against the author's
 * state when its turn comes (so it can depend on what earlier ones created)
 * and its requests are sent at once. The first rejection or failed request
 * stops the batch.
 */
async function applyBatch(deps: ApplyDeps, env: string, operations: readonly SinglePlanOperation[]): Promise<ApplyResult> {
  const client = deps.clientFor(env);
  const done: BatchOperationResult[] = [];
  for (const [position, op] of operations.entries()) {
    const index = position + 1;
    let draft;
    for (let attempt = 0; draft === undefined; attempt += 1) {
      try {
        draft = await draftBatchOperation(deps, env, op);
      } catch (error) {
        const rejection = rejectionFor(error);
        if (rejection === undefined) {
          throw error;
        }
        if (rejection.reason === "not-found" && attempt < BATCH_READ_RETRIES) {
          await deps.sleep(BATCH_READ_RETRY_MS);
          continue;
        }
        return { status: "failed", env, kind: "batch", operations: done, failed: { index, kind: op.kind, message: `${rejection.reason}: ${rejection.message}`, sent: 0 }, notRun: operations.length - index };
      }
    }
    let ok = 0;
    for (const step of draft.steps) {
      if (step.pauseBeforeMs !== undefined) {
        await deps.sleep(step.pauseBeforeMs);
      }
      try {
        await client.execute(step.request);
        ok += 1;
      } catch (error) {
        return {
          status: "failed",
          env,
          kind: "batch",
          operations: done,
          failed: { index, kind: op.kind, message: `${step.request.label}: ${failureMessage(error, step.hints)}`, sent: ok + 1 },
          notRun: operations.length - index,
        };
      }
    }
    done.push({ index, kind: op.kind, summary: draft.summary, sent: draft.steps.length, ok, ...(draft.steps.length === 0 ? { skipped: true } : {}) });
  }
  return { status: "applied", env, kind: "batch", operations: done };
}
