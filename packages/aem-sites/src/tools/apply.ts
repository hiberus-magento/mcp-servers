// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_apply` (aem-sites-package design.md, D1, D5, D8). Accepts only a
// token: the requests it sends are the ones `aem_plan` stored, byte for
// byte. Before the first write it checks, in order, that the token is
// known, unexpired and unused, that the echoes match, that a protected plan
// carries the typed confirmation, and that the state the user reviewed has
// not changed. Only then is the token consumed and the first request sent.
import { readPage, readSheet, type AemClient } from "../client/index.js";
import type { AemConfig } from "../config.js";
import { fingerprint } from "../confirm/fingerprint.js";
import type { PlanStore } from "../confirm/plan-store.js";
import type { StateCheck, StoredPlan } from "./plan-builder.js";
import type { AemApplyInput, OperationKind } from "./plan-schema.js";

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

export type ApplyResult =
  | { readonly status: "rejected"; readonly reason: ApplyRejectionReason; readonly message: string }
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
        failed: { label: step.request.label, message: error instanceof Error ? error.message : String(error) },
        notSent: plan.steps.length - index - 1,
      };
    }
  }
  return { status: "applied", env: plan.env, kind: plan.kind, results: completed };
}
