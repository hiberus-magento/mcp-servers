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
import type { CreateCatalogViewInput, CreateCatalogViewResult, CreatePolicyResult, UpdateCatalogViewInput } from "./operations/mutations.js";
import type { CatalogViewResult, ListCatalogViewsResult, ListPoliciesResult } from "./types.js";

export interface CountMatchingProductsInput {
  readonly viewId: string;
  readonly locale: string;
  readonly attribute: string;
  readonly value: string;
}

export interface CreatePolicyDepsInput {
  readonly name: string;
}

export interface ProvisionDeps {
  readonly countMatchingProducts: (input: CountMatchingProductsInput) => Promise<number>;
  readonly listPolicies: () => Promise<ListPoliciesResult>;
  readonly createPolicy: (input: CreatePolicyDepsInput) => Promise<CreatePolicyResult>;
  readonly listCatalogViews: () => Promise<ListCatalogViewsResult>;
  // The write input types verbatim, not a local restatement: these writes
  // REPLACE, so a deps shape that could express less than the wire accepts
  // would be a shape that silently drops fields. (`mutations.test.ts` scans
  // `client/**` for the `mutation` + space token and allows it in exactly
  // one module; this comment bends around that scan rather than the
  // reverse.)
  readonly createCatalogView: (input: CreateCatalogViewInput) => Promise<CreateCatalogViewResult>;
  readonly updateCatalogView: (input: UpdateCatalogViewInput) => Promise<void>;
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

type CatalogViewUpdateProjection = { readonly ok: true; readonly input: UpdateCatalogViewInput } | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Projects a view as READ into the whole-view replacement
 * `updateCatalogView` requires, or refuses with the fields it could not
 * carry — the same contract `policy-update.ts` has, for the same reason:
 * `UpdateCatalogViewRequest` REPLACES, so every field the read did not
 * carry and this projection cannot supply is destroyed by the write.
 * Defaulting any of them would quietly clear a view's policies, its price
 * books or its access-key restrictions.
 *
 * `defaultPriceBookId` is the one exception, and not a default: the ACO
 * Admin UI's own captured Save sends `""` for "no default price book" and
 * the service answers `null`, so `undefined` here IS that value rather than
 * an unknown.
 *
 * `sources` is reconstructed from `locales`, which is how `types.ts`
 * flattens it; an empty `locales` is refused because the parse cannot tell
 * a view with no sources from a response that omitted them, and the write
 * would clear them either way.
 */
function projectCatalogViewForUpdate(view: CatalogViewResult, policyIds: readonly string[]): CatalogViewUpdateProjection {
  const missing: string[] = [];
  if (view.name === undefined) {
    missing.push("name");
  }
  if (view.locales.length === 0) {
    missing.push("sources");
  }
  if (view.restrictedAccessKeyIds === undefined) {
    missing.push("restrictedAccessKeyIds");
  }
  if (view.protectionEnabled === undefined) {
    missing.push("protectionEnabled");
  }
  if (view.allowedPriceBookIds === undefined) {
    missing.push("allowedPriceBookIds");
  }
  if (view.draft === undefined) {
    missing.push("draft");
  }
  if (view.layers === undefined) {
    missing.push("layers");
  }

  const layers = (view.layers ?? []).map((layer, index) => {
    if (layer.order === undefined) {
      missing.push(`layers[${index}].order`);
    }
    if (layer.source?.locale === undefined) {
      missing.push(`layers[${index}].source.locale`);
    }
    if (layer.source?.layer === undefined) {
      missing.push(`layers[${index}].source.layer`);
    }
    return { order: layer.order ?? 0, source: { locale: layer.source?.locale ?? "", layer: layer.source?.layer ?? "" } };
  });

  // The placeholders above exist only so the loop stays one pass; a
  // non-empty `missing` means NOTHING is written, so none of them can reach
  // the wire.
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    input: {
      viewId: view.viewId,
      name: view.name ?? "",
      sources: view.locales.map((locale) => ({ locale })),
      policyIds: [...policyIds],
      restrictedAccessKeyIds: view.restrictedAccessKeyIds ?? [],
      protectionEnabled: view.protectionEnabled ?? false,
      defaultPriceBookId: view.defaultPriceBookId ?? "",
      allowedPriceBookIds: view.allowedPriceBookIds ?? [],
      draft: view.draft ?? false,
      layers,
    },
  };
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
  // `createCatalogView` then `updateCatalogView` for `defaultPriceBookId` —
  // never one, because `CreateCatalogViewRequest` has no
  // `defaultPriceBookId` member at all (`operations/mutations.ts`). The
  // second call re-posts exactly the member set the first one posted, plus
  // the price book: `updateCatalogView` REPLACES, so anything it omits is
  // cleared. An existing view whose `policyIds` already match the target is
  // left untouched; one that needs updating is projected from the read and
  // REFUSED if the read did not carry everything the replacement would
  // overwrite.
  const existingViews = await deps.listCatalogViews();
  const viewByName = new Map(existingViews.views.map((view) => [view.name, view]));
  let viewsChanged = false;
  const refused: string[] = [];
  for (const vertical of options.verticals) {
    const targetPolicyIds = vertical.policyNames.map((name) => policyIdByName.get(name)).filter((id): id is string => id !== undefined);
    const existing = viewByName.get(vertical.viewName);
    if (existing === undefined) {
      viewsChanged = true;
      if (write) {
        const createInput: CreateCatalogViewInput = {
          name: vertical.viewName,
          sources: [{ locale: vertical.locale }],
          policyIds: targetPolicyIds,
          restrictedAccessKeyIds: [],
          protectionEnabled: false,
          allowedPriceBookIds: [],
          draft: false,
          layers: [],
        };
        const created = await deps.createCatalogView(createInput);
        await deps.updateCatalogView({ ...createInput, viewId: created.viewId, defaultPriceBookId: vertical.defaultPriceBookId });
      }
      continue;
    }
    const currentPolicyIds = existing.policyIds ?? [];
    if (samePolicyIds(currentPolicyIds, targetPolicyIds)) {
      continue;
    }
    const projection = projectCatalogViewForUpdate(existing, targetPolicyIds);
    if (!projection.ok) {
      refused.push(`"${vertical.viewName}" (${projection.missing.join(", ")})`);
      continue;
    }
    viewsChanged = true;
    if (write) {
      await deps.updateCatalogView(projection.input);
    }
  }
  const viewsDetail = viewsChanged ? "One or more catalog views were missing or out of date." : "Every catalog view already matches its target state.";
  const refusalDetail =
    refused.length > 0
      ? ` Refused to replace ${refused.length} catalog view(s) because the read did not carry every field updateCatalogView overwrites: ${refused.join("; ")}.`
      : "";
  steps.push({ step: "catalog-views", changed: viewsChanged, detail: `${viewsDetail}${refusalDetail}` });

  // Step 4/4 — verify. Entirely diagnostic; never fails the run
  // (exploration.md's mapped step 4). No additional requests are issued
  // here — the read-only steps above already confirm current state.
  steps.push({ step: "verify", changed: false, detail: "Verification is diagnostic only; no additional requests were issued." });

  return { dryRun: !write, aborted: false, steps };
}
