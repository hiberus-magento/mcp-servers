// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `eds_apply` (eds-write-surface design.md, Decisions 2, 3, 5, 6). The only
// code path that writes to the Admin API, and it writes only what a plan
// recorded. Order matters:
//
//   1. peek — unknown, expired or used tokens stop here, nothing read;
//   2. site/kind echo, then confirmSite — the checks that run BEFORE
//      consumption (they read and write nothing), so the call can be repeated
//      correctly without re-planning;
//   3. consume — from here on the token is spent, whatever happens next, so
//      no retry loop can silently re-issue the writes;
//   4. stale check — re-read what the user reviewed; a mismatch writes nothing;
//   5. replay the recorded requests, in order, through `sendPlannedRequest`.
import type { EdsClient } from "../client/index.js";
import { fingerprint } from "../confirm/fingerprint.js";
import type { PlanRejection, PlanStore } from "../confirm/plan-store.js";
import type { Fingerprint, StoredPlan } from "./plan-builder.js";
import type { EdsApplyInput, OperationKind } from "./plan.js";
import { redactValue } from "./redact-output.js";

export type ApplyRejection = PlanRejection | "plan-mismatch" | "stale-plan" | "confirm-site-missing" | "confirm-site-mismatch";

export type ApplyResult =
  | {
      readonly status: "applied";
      readonly site: string;
      readonly kind: OperationKind;
      readonly responses: readonly unknown[];
      readonly job?: unknown;
      /** The newest configuration version before this change — a hint for `version.restore`, not a guaranteed rollback point (Decision 5). */
      readonly previousVersionId?: string;
    }
  | { readonly status: "rejected"; readonly reason: ApplyRejection; readonly message: string }
  /** Reserved for an out-of-band approval step; nothing in this change produces it (Decision 5). */
  | { readonly status: "pending"; readonly message: string };

export interface ApplyDeps {
  readonly client: EdsClient;
  readonly store: PlanStore<StoredPlan>;
}

const MESSAGES: Readonly<Record<ApplyRejection, string>> = {
  "unknown-token": "This token was never issued by this server, or the server has restarted since. Nothing was written. Plan the operation again with eds_plan.",
  expired: "This plan has expired (plans live ten minutes). Nothing was written. Plan the operation again with eds_plan and confirm it with the user.",
  used: "This token has already been used. Nothing was written now. Plan the operation again with eds_plan if it is still needed.",
  "plan-mismatch":
    "site and kind must be exactly the site and kind of the plan this token was issued for. Nothing was written, and the token is still valid. Pass them as eds_plan returned them.",
  "stale-plan":
    "What the user reviewed has changed since this plan was made. Nothing was written, and the token is spent. Plan again with eds_plan and show the new plan to the user.",
  "confirm-site-missing":
    "This site is protected: eds_apply needs confirmSite set to the site name the user typed. Nothing was written, and the token is still valid.",
  "confirm-site-mismatch":
    "confirmSite does not match the planned site exactly. Nothing was written, and the token is still valid; ask the user to type the site name again.",
};

function reject(reason: ApplyRejection): ApplyResult {
  return { status: "rejected", reason, message: MESSAGES[reason] };
}

async function isStale(client: EdsClient, org: string, site: string, recorded: Fingerprint): Promise<boolean> {
  switch (recorded.read) {
    case "site-absent":
      return client.operations.siteConfig.siteExists({ org, site });
    case "site-document":
      return fingerprint(await client.operations.siteConfig.getSiteDocument({ org, site })) !== recorded.sha256;
    case "robots":
      return fingerprint(await client.operations.robots.getRobots({ org, site })) !== recorded.sha256;
  }
}

function jobSelf(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const links = (response as { links?: unknown }).links;
  const self = typeof links === "object" && links !== null ? (links as { self?: unknown }).self : undefined;
  return typeof self === "string" ? self : undefined;
}

export async function applyPlan(deps: ApplyDeps, input: EdsApplyInput): Promise<ApplyResult> {
  const peeked = deps.store.peek(input.token);
  if (peeked.status === "rejected") return reject(peeked.reason);
  const plan = peeked.plan;

  if (input.site !== plan.site || input.kind !== plan.kind) return reject("plan-mismatch");
  if (input.confirmSite !== undefined && input.confirmSite !== plan.site) return reject("confirm-site-mismatch");
  if (plan.protected && input.confirmSite === undefined) return reject("confirm-site-missing");

  const consumed = deps.store.consume(input.token);
  if (consumed.status === "rejected") return reject(consumed.reason);

  if (plan.fingerprint !== undefined && (await isStale(deps.client, plan.org, plan.site, plan.fingerprint))) return reject("stale-plan");

  const responses: unknown[] = [];
  for (const request of plan.requests) {
    const written = await deps.client.sendPlannedRequest(request);
    responses.push(written.hasResponse ? written.response : null);
  }

  let job: unknown;
  if (plan.jobBacked) {
    const submitted = responses[0];
    const self = jobSelf(submitted);
    job = input.wait === true && self !== undefined ? await deps.client.jobs.waitForJob({ self }) : (submitted as { job?: unknown } | null)?.job;
  }

  return {
    status: "applied",
    site: plan.site,
    kind: plan.kind,
    responses: responses.map(redactValue),
    ...(job !== undefined ? { job: redactValue(job) } : {}),
    ...(plan.previousVersionId !== undefined ? { previousVersionId: plan.previousVersionId } : {}),
  };
}
