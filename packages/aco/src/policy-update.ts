// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The read-modify-write half of a policy filter toggle.
//
// `updatePolicy` REPLACES the policy it is given. There is no partial
// update, no patch, and no dedicated disable-a-filter mutation: the ACO
// Admin UI's own Save sends the WHOLE policy back with the one filter's
// `enabled` flipped, and that captured request is the only evidence of
// `UpdatePolicyRequest`'s shape there is. So every field the read does not
// fetch, or this projection does not send back, is destroyed by the write.
// That is the whole reason this module exists as its own named piece rather
// than a few lines inside a tool handler.
//
// Why it is not under `client/`: `client/index.ts`'s exported RUNTIME
// surface is exactly the error classes plus `createAcoClient`, asserted by
// `client/index.test.ts`. A pure projection function is not a transport
// call and does not belong on that facade, so it lives beside the two
// callers that need it — `tools/aco-tools.ts` and `cli.ts`. It is still
// pinned to the wire shape by `UpdatePolicyInput`, which it returns.
//
// WHAT IS PROVEN LOSSLESS, and what is not:
//
//   - `LIST_POLICIES_DOCUMENT` selects every member `UpdatePolicyRequest`
//     accepts (`policies.test.ts` pins the selection), a GraphQL response
//     carries exactly the fields selected, and the parse narrows them field
//     by field (`types.ts`). So the round trip carries everything the input
//     type can express.
//   - The singular `value` is the one field read but not written. It is not
//     a member of the captured request, and an input member the schema does
//     not declare fails the whole mutation — so sending it would break
//     every write rather than preserve anything. If the service does hold a
//     per-filter `value` that the input cannot express, Adobe's own Save
//     drops it too: this write is byte-for-byte the UI's.
//   - `createdAt`/`updatedAt` are response-only and server-managed.
//
// Anything absent from the read is refused rather than defaulted. A
// defaulted `actions: []` would delete every action the policy has.
import type { PolicyFilter, PolicyResult, UpdatePolicyActionInput, UpdatePolicyFilterInput, UpdatePolicyInput, UpdatePolicyTriggerInput } from "./client/index.js";

/** Where a filter sits inside a policy: `actions[actionIndex].filters[filterIndex]`. */
export interface PolicyFilterAddress {
  readonly actionIndex: number;
  readonly filterIndex: number;
}

export interface PolicyFilterMatch extends PolicyFilterAddress {
  readonly filter: PolicyFilter;
}

export type PolicyUpdateProjection = { readonly ok: true; readonly input: UpdatePolicyInput } | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Every filter carrying `attribute`, across every action. Filters have no
 * id, so an attribute is how a caller addresses one — and a policy may
 * carry the same attribute in more than one action, which is why this
 * returns a list the caller can refuse on rather than a first match.
 */
export function findFiltersByAttribute(policy: PolicyResult, attribute: string): readonly PolicyFilterMatch[] {
  const matches: PolicyFilterMatch[] = [];
  (policy.actions ?? []).forEach((action, actionIndex) => {
    (action.filters ?? []).forEach((filter, filterIndex) => {
      if (filter.attribute === attribute) {
        matches.push({ actionIndex, filterIndex, filter });
      }
    });
  });
  return matches;
}

/** The same policy with exactly one filter's `enabled` replaced. Every other field is carried through untouched. */
export function withFilterEnabled(policy: PolicyResult, address: PolicyFilterAddress, enabled: boolean): PolicyResult {
  const actions = (policy.actions ?? []).map((action, actionIndex) => {
    if (actionIndex !== address.actionIndex || action.filters === undefined) {
      return action;
    }
    return { ...action, filters: action.filters.map((filter, filterIndex) => (filterIndex === address.filterIndex ? { ...filter, enabled } : filter)) };
  });
  return { ...policy, actions };
}

/**
 * Projects a policy as read into the mutation's input, or refuses with the
 * paths of the fields it could not carry. Members are written out one by
 * one, never spread: a spread would put the read's own extra fields on the
 * wire, and one undeclared member of `UpdatePolicyRequest` fails the whole
 * mutation.
 */
export function projectPolicyForUpdate(policy: PolicyResult): PolicyUpdateProjection {
  const missing: string[] = [];
  if (policy.mandatory === undefined) {
    missing.push("mandatory");
  }
  if (policy.actions === undefined) {
    missing.push("actions");
  }

  const actions: UpdatePolicyActionInput[] = [];
  (policy.actions ?? []).forEach((action, actionIndex) => {
    const triggers: UpdatePolicyTriggerInput[] = [];
    if (action.triggers === undefined) {
      missing.push(`actions[${actionIndex}].triggers`);
    }
    (action.triggers ?? []).forEach((trigger, triggerIndex) => {
      const path = `actions[${actionIndex}].triggers[${triggerIndex}]`;
      if (trigger.transportType === undefined) {
        missing.push(`${path}.transportType`);
      }
      if (trigger.name === undefined) {
        missing.push(`${path}.name`);
      }
      triggers.push({ transportType: trigger.transportType ?? "", name: trigger.name ?? "" });
    });

    const filters: UpdatePolicyFilterInput[] = [];
    if (action.filters === undefined) {
      missing.push(`actions[${actionIndex}].filters`);
    }
    (action.filters ?? []).forEach((filter, filterIndex) => {
      const path = `actions[${actionIndex}].filters[${filterIndex}]`;
      if (filter.attribute === undefined) {
        missing.push(`${path}.attribute`);
      }
      if (filter.enabled === undefined) {
        missing.push(`${path}.enabled`);
      }
      if (filter.actionFilterOperator === undefined) {
        missing.push(`${path}.actionFilterOperator`);
      }
      if (filter.valueSource === undefined) {
        missing.push(`${path}.valueSource`);
      }
      if (filter.values === undefined) {
        missing.push(`${path}.values`);
      }
      filters.push({
        attribute: filter.attribute ?? "",
        enabled: filter.enabled ?? false,
        actionFilterOperator: filter.actionFilterOperator ?? "",
        valueSource: filter.valueSource ?? "",
        values: filter.values ?? [],
      });
    });

    actions.push({ triggers, filters });
  });

  // The placeholders above exist only so the loop stays one pass; a
  // non-empty `missing` means NOTHING is written, so none of them can reach
  // the wire.
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, input: { policyId: policy.policyId, name: policy.name, mandatory: policy.mandatory ?? false, actions } };
}
