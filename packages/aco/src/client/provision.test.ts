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
//   - creating a catalog view is TWO calls, `createChannel` then
//     `updateChannel` — never one.
import { describe, expect, it } from "vitest";
import { SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX, SYNTHETIC_LOCALES, SYNTHETIC_VERTICALS } from "@hiberus-magento/mcp-testing";
import type { CreateChannelResult, CreatePolicyResult } from "./operations/mutations.js";
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
  const calls = { createChannel: 0, updateChannel: 0, createPolicy: 0, countMatchingProducts: 0 };

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
    // The three mutations still speak `channelId` on the wire — that rename
    // was never verified against the live service, so this fake mirrors the
    // shape the client still sends rather than assuming it moved too.
    createChannel: async (input): Promise<CreateChannelResult> => {
      calls.createChannel += 1;
      const channelId = `acv-demo-${catalogViews.length + 1}`;
      catalogViews.push({ viewId: channelId, name: input.name, locales: [input.locale] });
      return { channelId };
    },
    updateChannel: async (input) => {
      calls.updateChannel += 1;
      const index = catalogViews.findIndex((view) => view.viewId === input.channelId);
      if (index >= 0) {
        const current = catalogViews[index] as CatalogViewResult;
        catalogViews[index] = {
          ...current,
          ...(input.defaultPriceBookId !== undefined ? { defaultPriceBookId: input.defaultPriceBookId } : {}),
          ...(input.policyIds !== undefined ? { policyIds: input.policyIds } : {}),
        };
      }
    },
  };

  return { deps, calls, catalogViews, policies };
}

describe("provision", () => {
  it("the default invocation issues ZERO mutation requests", async () => {
    const { deps, calls } = makeDeps();

    const result = await provision(deps, { verticals: [verticalInput()] });

    expect(result.dryRun).toBe(true);
    expect(calls.createChannel).toBe(0);
    expect(calls.updateChannel).toBe(0);
    expect(calls.createPolicy).toBe(0);
  });

  it("a second run with writes enabled against unchanged state issues no mutations", async () => {
    const { deps, calls } = makeDeps();

    const first = await provision(deps, { verticals: [verticalInput()], write: true });
    expect(first.aborted).toBe(false);
    const afterFirst = { ...calls };
    expect(afterFirst.createChannel).toBeGreaterThan(0);

    await provision(deps, { verticals: [verticalInput()], write: true });

    expect(calls.createChannel).toBe(afterFirst.createChannel);
    expect(calls.updateChannel).toBe(afterFirst.updateChannel);
    expect(calls.createPolicy).toBe(afterFirst.createPolicy);
  });

  it("a zero-match vertical aborts the WHOLE run before any write", async () => {
    const { deps, calls } = makeDeps({ productCounts: { "color=green": 0 } });

    const result = await provision(deps, { verticals: [verticalInput(), verticalInput({ vertical: OTHER_VERTICAL, viewName: `${OTHER_VERTICAL}_view` })], write: true });

    expect(result.aborted).toBe(true);
    expect(calls.createChannel).toBe(0);
    expect(calls.updateChannel).toBe(0);
    expect(calls.createPolicy).toBe(0);
  });

  it("creating a catalog view is TWO calls: createChannel then updateChannel", async () => {
    const { deps, calls } = makeDeps();

    await provision(deps, { verticals: [verticalInput()], write: true });

    expect(calls.createChannel).toBe(1);
    expect(calls.updateChannel).toBe(1);
  });
});
