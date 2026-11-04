// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_apply` (aem-sites-package design.md, D1, D5, D8). Accepts only a
// token: the requests it sends are the ones `aem_plan` stored, byte for
// byte. Before the first write it checks, in order, that the token is
// known, unexpired and unused, that the echoes match, that a protected plan
// carries the typed confirmation, and that the state the user reviewed has
// not changed. Only then is the token consumed and the first request sent.
import { AemError, readComponent, readPage, readSheet, confExists, type AemClient } from "../client/index.js";
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
  /** Called before each batch operation and after each request it sends, so a long batch keeps the client's call alive. */
  readonly reportProgress?: (progress: number, total: number | undefined, message: string) => Promise<void>;
}

const reject = (reason: ApplyRejectionReason, message: string): ApplyResult => ({ status: "rejected", reason, message });

/** How often and how long apply waits for an async rollout job to reach its targets. */
export const ROLLOUT_POLL_MS = 3000;
export const ROLLOUT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Waits until every target's `cq:lastRolledout` differs from the value read
 * when the plan was made. Throws naming the targets the job has not reached.
 */
async function awaitRollout(deps: ApplyDeps, client: AemClient, targets: NonNullable<PlannedStep["awaitRollout"]>): Promise<void> {
  let pending = [...targets];
  for (let waited = 0; ; waited += ROLLOUT_POLL_MS) {
    const still: typeof pending = [];
    for (const target of pending) {
      const page = await readPage(client.http, target.path, ["cq:lastRolledout"]);
      const last = page?.properties["cq:lastRolledout"];
      if (typeof last !== "string" || last === target.before) {
        still.push(target);
      }
    }
    pending = still;
    if (pending.length === 0) {
      return;
    }
    if (waited >= ROLLOUT_TIMEOUT_MS) {
      throw new Error(`The rollout job was accepted but has not reached ${pending.map((t) => t.path).join(", ")} after ${ROLLOUT_TIMEOUT_MS / 1000} s; check the targets before running anything that depends on them.`);
    }
    await deps.sleep(ROLLOUT_POLL_MS);
  }
}

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
    case "conf-absent":
      return !(await confExists(client.http, check.path));
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
      if (step.awaitRollout !== undefined) {
        await awaitRollout(deps, client, step.awaitRollout);
      }
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
 * stops the batch. Progress counts finished operations, with the share of an
 * operation's requests already sent as the fraction.
 */
async function applyBatch(deps: ApplyDeps, env: string, operations: readonly SinglePlanOperation[]): Promise<ApplyResult> {
  const client = deps.clientFor(env);
  const done: BatchOperationResult[] = [];
  let reported = -1;
  // Best effort: a notification the client cannot take never stops the batch, and progress only grows.
  const progress = async (value: number, message: string): Promise<void> => {
    if (deps.reportProgress === undefined || value <= reported) {
      return;
    }
    reported = value;
    try {
      await deps.reportProgress(value, operations.length, message);
    } catch {
      // The client may have gone; the batch keeps running.
    }
  };
  for (const [position, op] of operations.entries()) {
    const index = position + 1;
    await progress(position, `operation ${index}/${operations.length}: ${op.kind}`);
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
        if (step.awaitRollout !== undefined) {
          await awaitRollout(deps, client, step.awaitRollout);
        }
        ok += 1;
        await progress(position + ok / draft.steps.length, `operation ${index}/${operations.length}: ${step.request.label}`);
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
