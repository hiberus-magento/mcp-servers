// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListPolicies` — `Q_POLICIES` (exploration.md). Admin track. Backs
// `aco_list_policies`, `aco_toggle_policy`'s lookup step, and `provision`'s
// policy step's name-keyed idempotency check.
//
// `enabled` is requested defensively (Phase 5, tasks.md 5.7/5.8): it is NOT
// part of the Python CLI's own `Q_POLICIES` field list in exploration.md —
// that CLI's own `policy enable`/`disable` never reads current state back
// either, so this is genuinely undocumented. `types.ts`'s tolerant parsing
// resolves it to `undefined` if Adobe's schema does not actually return it,
// and `aco_toggle_policy`'s handler treats "unknown" as "always mutate"
// rather than silently claiming a no-op it cannot prove.
import type { AdminTransport } from "../http.js";
import { parseListPoliciesResult, type ListPoliciesResult } from "../types.js";

const LIST_POLICIES_DOCUMENT = `query ListPolicies {
  policies {
    policyId
    name
    mandatory
    enabled
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
