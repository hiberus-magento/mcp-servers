// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `updatePolicy` REPLACES the policy it is given, so a filter
// toggle is a read-modify-write of the WHOLE policy and any field the
// projection drops is destroyed. These tests are the unit half of that
// proof; the end-to-end half — the posted mutation variables for a real
// toggle — lives in `tools/aco-tools.test.ts`.
import { describe, expect, it } from "vitest";
import type { PolicyAction, PolicyResult } from "./client/index.js";
import { findFiltersByAttribute, projectPolicyForUpdate, withFilterEnabled } from "./policy-update.js";

const FULL_ACTIONS: readonly PolicyAction[] = [
  {
    triggers: [{ name: "on-catalog-read", transportType: "GRAPHQL" }],
    filters: [
      { attribute: "vertical", values: ["outdoor-gear"], value: "outdoor-gear", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC" },
      { attribute: "price_band", values: ["mid", "high"], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" },
    ],
  },
];

/** Every field `UpdatePolicyRequest` accepts, populated, plus the read-only singular `value`. */
const FULL_POLICY: PolicyResult = {
  policyId: "pol-demo-1",
  name: "outdoor-gear-discount",
  mandatory: false,
  actions: FULL_ACTIONS,
};

describe("projectPolicyForUpdate", () => {
  it("carries every member UpdatePolicyRequest accepts, for every filter", () => {
    const projection = projectPolicyForUpdate(FULL_POLICY);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.input).toEqual({
      policyId: "pol-demo-1",
      name: "outdoor-gear-discount",
      mandatory: false,
      actions: [
        {
          triggers: [{ transportType: "GRAPHQL", name: "on-catalog-read" }],
          filters: [
            { attribute: "vertical", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC", values: ["outdoor-gear"] },
            { attribute: "price_band", enabled: false, actionFilterOperator: "IN", valueSource: "STATIC", values: ["mid", "high"] },
          ],
        },
      ],
    });
  });

  /**
   * The singular `value` is read and deliberately not written: the only
   * evidence of `UpdatePolicyRequest`'s shape is the Admin UI's own Save,
   * which sends `values` and never `value`, and an undeclared input member
   * fails the whole mutation.
   */
  it("drops the singular `value`, which the input type does not declare", () => {
    const projection = projectPolicyForUpdate(FULL_POLICY);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(JSON.stringify(projection.input)).not.toContain('"value"');
  });

  it("refuses rather than inventing a value when `mandatory` is absent", () => {
    const projection = projectPolicyForUpdate({ policyId: "pol-demo-1", name: "outdoor-gear-discount", actions: FULL_ACTIONS });

    expect(projection.ok).toBe(false);
    if (projection.ok) {
      return;
    }
    expect(projection.missing).toEqual(["mandatory"]);
  });

  /**
   * The worst case: `actions` absent would project to `[]` and the write
   * would delete every action the policy has. An empty array is a real
   * state and is fine; an ABSENT one is unknown state.
   */
  it("refuses when `actions` is absent, rather than sending an empty list that would delete them", () => {
    const projection = projectPolicyForUpdate({ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false });

    expect(projection.ok).toBe(false);
    if (projection.ok) {
      return;
    }
    expect(projection.missing).toEqual(["actions"]);
  });

  it("accepts an empty actions list, which is a known state", () => {
    expect(projectPolicyForUpdate({ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [] }).ok).toBe(true);
  });

  it("names every missing filter member by its path", () => {
    const projection = projectPolicyForUpdate({
      policyId: "pol-demo-1",
      name: "outdoor-gear-discount",
      mandatory: false,
      actions: [{ triggers: [], filters: [{ attribute: "vertical", enabled: true }] }],
    });

    expect(projection.ok).toBe(false);
    if (projection.ok) {
      return;
    }
    expect(projection.missing).toEqual(["actions[0].filters[0].actionFilterOperator", "actions[0].filters[0].valueSource", "actions[0].filters[0].values"]);
  });

  it("names an absent triggers list by its path", () => {
    const projection = projectPolicyForUpdate({ policyId: "pol-demo-1", name: "outdoor-gear-discount", mandatory: false, actions: [{ filters: [] }] });

    expect(projection.ok).toBe(false);
    if (projection.ok) {
      return;
    }
    expect(projection.missing).toEqual(["actions[0].triggers"]);
  });
});

describe("findFiltersByAttribute", () => {
  it("finds the one filter carrying the attribute, with its position", () => {
    expect(findFiltersByAttribute(FULL_POLICY, "price_band")).toEqual([{ actionIndex: 0, filterIndex: 1, filter: FULL_POLICY.actions?.[0]?.filters?.[1] }]);
  });

  it("returns nothing for an attribute no filter carries", () => {
    expect(findFiltersByAttribute(FULL_POLICY, "colour")).toEqual([]);
  });

  it("returns every match across actions, so an ambiguous address can be refused rather than guessed", () => {
    const twoActions: PolicyResult = {
      ...FULL_POLICY,
      actions: [
        { triggers: [], filters: [{ attribute: "vertical", values: [], enabled: true, actionFilterOperator: "IN", valueSource: "STATIC" }] },
        { triggers: [], filters: [{ attribute: "vertical", values: [], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" }] },
      ],
    };

    expect(findFiltersByAttribute(twoActions, "vertical")).toHaveLength(2);
  });
});

describe("withFilterEnabled", () => {
  it("flips exactly the addressed filter and leaves every other field identical", () => {
    const flipped = withFilterEnabled(FULL_POLICY, { actionIndex: 0, filterIndex: 1 }, true);

    expect(flipped.actions?.[0]?.filters?.[1]?.enabled).toBe(true);
    expect(flipped).toEqual({
      ...FULL_POLICY,
      actions: [
        {
          triggers: FULL_POLICY.actions?.[0]?.triggers,
          filters: [FULL_POLICY.actions?.[0]?.filters?.[0], { ...FULL_POLICY.actions?.[0]?.filters?.[1], enabled: true }],
        },
      ],
    });
  });

  it("keeps the singular `value` on the untouched filter — dropping it is the write's job, not this one's", () => {
    const flipped = withFilterEnabled(FULL_POLICY, { actionIndex: 0, filterIndex: 1 }, true);

    expect(flipped.actions?.[0]?.filters?.[0]?.value).toBe("outdoor-gear");
  });
});
