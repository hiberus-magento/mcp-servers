// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListPolicies` — `Q_POLICIES` (exploration.md). Admin track. Backs
// `aco_list_policies`, `aco_toggle_policy`'s lookup step, and `provision`'s
// policy step's name-keyed idempotency check.
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
