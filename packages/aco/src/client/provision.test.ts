// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.14): `provision` is a four-step pure pipeline over
// injected values (design.md, Decision — "provision Is Dry-Run by Default
// and Idempotent"), the single most important UX property to preserve.
// Four properties, proven directly against call counts on injected fakes
// (no live tenant, no fetch double — the pipeline itself is transport-free):
//   - the default invocation issues ZERO mutation requests;
//   - a second run with writes enabled against unchanged state issues none;
//   - a zero-match vertical aborts the WHOLE run before any write;
//   - creating a catalog view is TWO calls, `createCatalogView` then
//     `updateCatalogView` — never one.
//
// CHANGED DELIBERATELY: the fakes below spoke `channelId`/`locale`. Those
// mutations were renamed and reshaped against captures of the ACO Admin
// UI's own requests (`operations/mutations.ts`), and `updateCatalogView`
// REPLACES the view it is given — so the fakes now record the WHOLE input,
// not a call count alone. A fake that accepts a partial update is a fake
// that cannot see the field the real service would have cleared.
import { describe, expect, it } from "vitest";
import { SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX, SYNTHETIC_LOCALES, SYNTHETIC_VERTICALS } from "@hiberus-magento/mcp-testing";
import type { CreateCatalogViewInput, CreateCatalogViewResult, CreatePolicyResult, UpdateCatalogViewInput } from "./operations/mutations.js";
import type { CatalogViewResult, PolicyResult } from "./types.js";
import { provision, type ProvisionDeps, type ProvisionVerticalInput } from "./provision.js";

const LOCALE = SYNTHETIC_LOCALES[0];
const VERTICAL = SYNTHETIC_VERTICALS[0];
const OTHER_VERTICAL = SYNTHETIC_VERTICALS[1];

function verticalInput(overrides: Partial<ProvisionVerticalInput> = {}): ProvisionVerticalInput {
  return {
    vertical: VERTICAL,
    viewName: `${VERTICAL}_view`,
    locale: LOCALE,
    probeViewId: "acv-demo-probe",
    attribute: "color",
    expectedValue: "green",
    defaultPriceBookId: `${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}eur`,
    policyNames: [`${VERTICAL}-discount`],
    ...overrides,
  };
}

interface FakeState {
  readonly catalogViews: CatalogViewResult[];
  readonly policies: PolicyResult[];
  readonly productCounts: Record<string, number>;
}

function makeDeps(state: Partial<FakeState> = {}) {
  const catalogViews: CatalogViewResult[] = state.catalogViews !== undefined ? [...state.catalogViews] : [];
  const policies: PolicyResult[] = state.policies !== undefined ? [...state.policies] : [];
  const productCounts = state.productCounts ?? {};
  const calls = { createCatalogView: 0, updateCatalogView: 0, createPolicy: 0, countMatchingProducts: 0 };
  const posted: { createCatalogView: CreateCatalogViewInput[]; updateCatalogView: UpdateCatalogViewInput[] } = { createCatalogView: [], updateCatalogView: [] };

  const deps: ProvisionDeps = {
    countMatchingProducts: async (input) => {
      calls.countMatchingProducts += 1;
      const key = `${input.attribute}=${input.value}`;
      return productCounts[key] ?? 5;
    },
    listPolicies: async () => ({ policies: [...policies] }),
    createPolicy: async (input): Promise<CreatePolicyResult> => {
      calls.createPolicy += 1;
      const policyId = `pol-demo-${policies.length + 1}`;
      policies.push({ policyId, name: input.name });
      return { policyId };
    },
    listCatalogViews: async () => ({ views: [...catalogViews] }),
    createCatalogView: async (input): Promise<CreateCatalogViewResult> => {
      calls.createCatalogView += 1;
      posted.createCatalogView.push(input);
      const viewId = `acv-demo-${catalogViews.length + 1}`;
      catalogViews.push({
        viewId,
        name: input.name,
        locales: input.sources.map((source) => source.locale),
        policyIds: input.policyIds,
        restrictedAccessKeyIds: input.restrictedAccessKeyIds,
        protectionEnabled: input.protectionEnabled,
        allowedPriceBookIds: input.allowedPriceBookIds,
        draft: input.draft,
        layers: input.layers,
      });
      return { viewId };
    },
    // REPLACES, exactly as the real one does: the stored view becomes what
    // the write sent and nothing more. A fake that merged would hide every
    // field the caller forgot to carry.
    updateCatalogView: async (input) => {
      calls.updateCatalogView += 1;
      posted.updateCatalogView.push(input);
      const index = catalogViews.findIndex((view) => view.viewId === input.viewId);
      if (index >= 0) {
        catalogViews[index] = {
          viewId: input.viewId,
          name: input.name,
          locales: input.sources.map((source) => source.locale),
          policyIds: input.policyIds,
          restrictedAccessKeyIds: input.restrictedAccessKeyIds,
          protectionEnabled: input.protectionEnabled,
          defaultPriceBookId: input.defaultPriceBookId,
          allowedPriceBookIds: input.allowedPriceBookIds,
          draft: input.draft,
          layers: input.layers,
        };
      }
    },
  };

  return { deps, calls, posted, catalogViews, policies };
}

describe("provision", () => {
  it("the default invocation issues ZERO mutation requests", async () => {
    const { deps, calls } = makeDeps();

    const result = await provision(deps, { verticals: [verticalInput()] });

    expect(result.dryRun).toBe(true);
    expect(calls.createCatalogView).toBe(0);
    expect(calls.updateCatalogView).toBe(0);
    expect(calls.createPolicy).toBe(0);
  });

  it("a second run with writes enabled against unchanged state issues no mutations", async () => {
    const { deps, calls } = makeDeps();

    const first = await provision(deps, { verticals: [verticalInput()], write: true });
    expect(first.aborted).toBe(false);
    const afterFirst = { ...calls };
    expect(afterFirst.createCatalogView).toBeGreaterThan(0);

    await provision(deps, { verticals: [verticalInput()], write: true });

    expect(calls.createCatalogView).toBe(afterFirst.createCatalogView);
    expect(calls.updateCatalogView).toBe(afterFirst.updateCatalogView);
    expect(calls.createPolicy).toBe(afterFirst.createPolicy);
  });

  it("a zero-match vertical aborts the WHOLE run before any write", async () => {
    const { deps, calls } = makeDeps({ productCounts: { "color=green": 0 } });

    const result = await provision(deps, { verticals: [verticalInput(), verticalInput({ vertical: OTHER_VERTICAL, viewName: `${OTHER_VERTICAL}_view` })], write: true });

    expect(result.aborted).toBe(true);
    expect(calls.createCatalogView).toBe(0);
    expect(calls.updateCatalogView).toBe(0);
    expect(calls.createPolicy).toBe(0);
  });

  it("creating a catalog view is TWO calls: createCatalogView then updateCatalogView", async () => {
    const { deps, calls } = makeDeps();

    await provision(deps, { verticals: [verticalInput()], write: true });

    expect(calls.createCatalogView).toBe(1);
    expect(calls.updateCatalogView).toBe(1);
  });

  /**
   * `updateCatalogView` REPLACES. The follow-up call that exists only to
   * attach `defaultPriceBookId` must therefore re-post everything the
   * create posted — a partial second call would clear the view it just
   * made.
   */
  it("the follow-up update re-posts the whole view, not just the price book", async () => {
    const { deps, posted, catalogViews } = makeDeps();
    const vertical = verticalInput();

    await provision(deps, { verticals: [vertical], write: true });

    const created = posted.createCatalogView[0];
    expect(posted.updateCatalogView[0]).toEqual({ ...created, viewId: catalogViews[0]?.viewId, defaultPriceBookId: vertical.defaultPriceBookId });
    expect(catalogViews[0]?.name).toBe(vertical.viewName);
    expect(catalogViews[0]?.locales).toEqual([vertical.locale]);
  });

  /**
   * The read is the only source for a replacement of an EXISTING view. When
   * it did not carry a field the write would overwrite, provisioning
   * refuses that view and says which fields were missing — it does not
   * default them, because a defaulted `allowedPriceBookIds: []` clears the
   * view's price books.
   */
  it("refuses to replace an existing view whose read was missing fields, and names them", async () => {
    const partiallyRead: CatalogViewResult = { viewId: "acv-demo-existing", name: `${VERTICAL}_view`, locales: [LOCALE], policyIds: [] };
    const { deps, calls } = makeDeps({ catalogViews: [partiallyRead], policies: [{ policyId: "pol-demo-1", name: `${VERTICAL}-discount` }] });

    const result = await provision(deps, { verticals: [verticalInput()], write: true });

    expect(calls.updateCatalogView).toBe(0);
    const step = result.steps.find((entry) => entry.step === "catalog-views");
    expect(step?.detail).toContain("Refused to replace 1 catalog view(s)");
    expect(step?.detail).toContain("allowedPriceBookIds");
    expect(step?.detail).toContain("draft");
  });

  it("replaces an existing view whose read WAS complete, carrying every field forward and changing only policyIds", async () => {
    const fullyRead: CatalogViewResult = {
      viewId: "acv-demo-existing",
      name: `${VERTICAL}_view`,
      locales: [LOCALE],
      policyIds: [],
      restrictedAccessKeyIds: ["ak-demo-1"],
      protectionEnabled: true,
      defaultPriceBookId: `${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}gbp`,
      allowedPriceBookIds: [`${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}gbp`],
      draft: false,
      layers: [{ order: 0, source: { locale: LOCALE, layer: "base" } }],
    };
    const { deps, posted } = makeDeps({ catalogViews: [fullyRead], policies: [{ policyId: "pol-demo-1", name: `${VERTICAL}-discount` }] });

    await provision(deps, { verticals: [verticalInput()], write: true });

    expect(posted.updateCatalogView[0]).toEqual({
      viewId: "acv-demo-existing",
      name: `${VERTICAL}_view`,
      sources: [{ locale: LOCALE }],
      policyIds: ["pol-demo-1"],
      restrictedAccessKeyIds: ["ak-demo-1"],
      protectionEnabled: true,
      defaultPriceBookId: `${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}gbp`,
      allowedPriceBookIds: [`${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}gbp`],
      draft: false,
      layers: [{ order: 0, source: { locale: LOCALE, layer: "base" } }],
    });
  });
});
