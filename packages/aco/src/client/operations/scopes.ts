// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListScopes` — `{ scopes { locale } }` (exploration.md, `Q_SOURCES`).
// Admin track. Used by `provision`'s validate-attribute step to confirm a
// target locale is configured in the tenant before probing product counts
// against it. Named per design.md, Decision 5 — the fetch double keys
// routes on the operation name extracted from the posted document.
import type { AdminTransport } from "../http.js";
import { parseListScopesResult, type ListScopesResult } from "../types.js";

const LIST_SCOPES_DOCUMENT = `query ListScopes {
  scopes {
    locale
  }
}`;

export async function listScopes(transport: AdminTransport): Promise<ListScopesResult> {
  return transport.execute({
    track: "admin",
    document: LIST_SCOPES_DOCUMENT,
    parse: (data) => parseListScopesResult(data),
  });
}
