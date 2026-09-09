// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Wire + domain types, and the one parse point for tolerant shapes
// (design.md, Decision 5). A site-list response is documented to diverge
// between a bare array and `{ sites: [...] }`; `parseSiteList` is the only
// place that distinction is resolved.
export interface SiteListResult {
  readonly sites: readonly string[];
}

export type SiteListWire = readonly string[] | { readonly sites: readonly string[] };

export function parseSiteList(wire: SiteListWire): SiteListResult {
  if ("sites" in wire) {
    return { sites: wire.sites };
  }
  return { sites: wire };
}
