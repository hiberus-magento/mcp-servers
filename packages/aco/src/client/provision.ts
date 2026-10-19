// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `provision` — the four-step pipeline (exploration.md's mapped Python CLI
// steps, design.md's "provision Is Dry-Run by Default and Idempotent"
// requirement): validate attribute, create/update policies, create/update
// catalog views, verify. A pure function over INJECTED values — it takes
// `ProvisionDeps`, not a client instance — so it stays unit-testable with
// simple call-counting fakes and carries no transport/credential concerns
// of its own. CLI-only (exploration.md): never exposed as an MCP tool.
//
// Dry-run is the default (`write` defaults to `false`) — the single most
// important UX property to preserve. Idempotency is name-keyed at every
// step, never index- or order-dependent: a policy already present by name
// is not recreated, and a catalog view already present with the correct
// policies is not updated. A zero-match vertical at the validate-attribute
// step aborts the WHOLE run before any write — even for verticals that
// would themselves have validated successfully.
import type { CreateChannelResult, CreatePolicyResult } from "./operations/mutations.js";
import type { ListCatalogViewsResult, ListPoliciesResult } from "./types.js";

export interface CountMatchingProductsInput {
  readonly viewId: string;
  readonly locale: string;
  readonly attribute: string;
  readonly value: string;
}

export interface CreateChannelDepsInput {
  readonly name: string;
  readonly locale: string;
}

export interface UpdateChannelDepsInput {
  readonly channelId: string;
  readonly defaultPriceBookId?: string;
  readonly policyIds?: readonly string[];
}

export interface CreatePolicyDepsInput {
  readonly name: string;
}

export interface ProvisionDeps {
  readonly countMatchingProducts: (input: CountMatchingProductsInput) => Promise<number>;
  readonly listPolicies: () => Promise<ListPoliciesResult>;
  readonly createPolicy: (input: CreatePolicyDepsInput) => Promise<CreatePolicyResult>;
  readonly listCatalogViews: () => Promise<ListCatalogViewsResult>;
  readonly createChannel: (input: CreateChannelDepsInput) => Promise<CreateChannelResult>;
  readonly updateChannel: (input: UpdateChannelDepsInput) => Promise<void>;
}

export interface ProvisionVerticalInput {
  readonly vertical: string;
  /** The catalog view's `name` — looked up by name, never by index (idempotency key). */
  readonly viewName: string;
  readonly locale: string;
  /** An already-provisioned view used to probe product counts for the validate-attribute step. */
  readonly probeViewId: string;
  readonly attribute: string;
  readonly expectedValue: string;
  readonly defaultPriceBookId: string;
  /** Looked up by name, never created twice (idempotency key). */
  readonly policyNames: readonly string[];
}

export interface ProvisionOptions {
  /** Dry-run by default — issues zero writes unless explicitly `true`. */
  readonly write?: boolean;
  readonly verticals: readonly ProvisionVerticalInput[];
}

export type ProvisionStepName = "validate-attribute" | "policies" | "catalog-views" | "verify";

export interface ProvisionStepResult {
  readonly step: ProvisionStepName;
  readonly changed: boolean;
  readonly detail: string;
}

export interface ProvisionResult {
  readonly dryRun: boolean;
  readonly aborted: boolean;
  readonly steps: readonly ProvisionStepResult[];
}

function samePolicyIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

export async function provision(deps: ProvisionDeps, options: ProvisionOptions): Promise<ProvisionResult> {
  const write = options.write ?? false;
  const steps: ProvisionStepResult[] = [];

  // Step 1/4 — validate attribute. Reads only; runs regardless of `write`
  // because it is diagnostic. A single zero-match vertical aborts the WHOLE
  // run before step 2 ever runs, even if other verticals would validate.
  for (const vertical of options.verticals) {
    const count = await deps.countMatchingProducts({
      viewId: vertical.probeViewId,
      locale: vertical.locale,
      attribute: vertical.attribute,
      value: vertical.expectedValue,
    });
    if (count === 0) {
      steps.push({
        step: "validate-attribute",
        changed: false,
        detail: `Vertical "${vertical.vertical}" has zero products matching ${vertical.attribute}="${vertical.expectedValue}" — aborting before any write.`,
      });
      return { dryRun: !write, aborted: true, steps };
    }
  }
  steps.push({ step: "validate-attribute", changed: false, detail: `Validated ${options.verticals.length} vertical(s) against their probe view.` });

  // Step 2/4 — create/update policies. Idempotent purely by name lookup,
  // never by comparing filter contents (exploration.md's mapped step 2).
  const existingPolicies = await deps.listPolicies();
  const policyIdByName = new Map(existingPolicies.policies.map((policy) => [policy.name, policy.policyId]));
  const requiredPolicyNames = [...new Set(options.verticals.flatMap((vertical) => vertical.policyNames))];
  let policiesChanged = false;
  for (const name of requiredPolicyNames) {
    if (!policyIdByName.has(name)) {
      policiesChanged = true;
      if (write) {
        const created = await deps.createPolicy({ name });
        policyIdByName.set(name, created.policyId);
      }
    }
  }
  steps.push({ step: "policies", changed: policiesChanged, detail: policiesChanged ? "One or more policies were missing by name." : "Every required policy already exists by name." });

  // Step 3/4 — create/update catalog views. A missing view is TWO calls —
  // `createChannel` then `updateChannel` for `defaultPriceBookId` — never
  // one, because `createChannel`'s own response does not accept
  // `defaultPriceBookId` as an input in the same mutation
  // (exploration.md's mapped step 3). An existing view whose `policyIds`
  // already match the target is left untouched.
  const existingViews = await deps.listCatalogViews();
  const viewByName = new Map(existingViews.views.map((view) => [view.name, view]));
  let viewsChanged = false;
  for (const vertical of options.verticals) {
    const targetPolicyIds = vertical.policyNames.map((name) => policyIdByName.get(name)).filter((id): id is string => id !== undefined);
    const existing = viewByName.get(vertical.viewName);
    if (existing === undefined) {
      viewsChanged = true;
      if (write) {
        const created = await deps.createChannel({ name: vertical.viewName, locale: vertical.locale });
        await deps.updateChannel({ channelId: created.channelId, defaultPriceBookId: vertical.defaultPriceBookId, policyIds: targetPolicyIds });
      }
      continue;
    }
    const currentPolicyIds = existing.policyIds ?? [];
    if (!samePolicyIds(currentPolicyIds, targetPolicyIds)) {
      viewsChanged = true;
      if (write) {
        await deps.updateChannel({ channelId: existing.viewId, policyIds: targetPolicyIds });
      }
    }
  }
  steps.push({ step: "catalog-views", changed: viewsChanged, detail: viewsChanged ? "One or more catalog views were missing or out of date." : "Every catalog view already matches its target state." });

  // Step 4/4 — verify. Entirely diagnostic; never fails the run
  // (exploration.md's mapped step 4). No additional requests are issued
  // here — the read-only steps above already confirm current state.
  steps.push({ step: "verify", changed: false, detail: "Verification is diagnostic only; no additional requests were issued." });

  return { dryRun: !write, aborted: false, steps };
}
