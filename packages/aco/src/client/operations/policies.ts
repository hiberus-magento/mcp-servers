// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListPolicies` — `Q_POLICIES` (exploration.md). Admin track. Backs
// `aco_list_policies`, `aco_toggle_policy`'s lookup step, and `provision`'s
// policy step's name-keyed idempotency check.
//
// This document once requested a policy-level `enabled` "defensively"
// (Phase 5, tasks.md 5.7/5.8), on the theory that Adobe's schema might
// return it even though the Python CLI's own `Q_POLICIES` field list does
// not ask for it. It does not: `PolicyResponse` has `policyId`, `name`,
// `mandatory` and `actions` and no state field of any name, and asking for
// one answers `Cannot query field "enabled" on type "PolicyResponse"` —
// which fails the WHOLE query, so this operation returned nothing live.
// The nested `filters { enabled }` below is a different field on a
// different type and is real; `policies.test.ts` pins both halves.
import type { AdminTransport } from "../http.js";
import { parseListPoliciesResult, type ListPoliciesResult } from "../types.js";

const LIST_POLICIES_DOCUMENT = `query ListPolicies {
  policies {
    policyId
    name
    mandatory
    actions {
      triggers {
        name
        transportType
      }
      filters {
        attribute
        values
        value
        enabled
        actionFilterOperator
        valueSource
      }
    }
  }
}`;

export async function listPolicies(transport: AdminTransport): Promise<ListPoliciesResult> {
  return transport.execute({
    track: "admin",
    document: LIST_POLICIES_DOCUMENT,
    parse: (data) => parseListPoliciesResult(data, "ListPolicies"),
  });
}
