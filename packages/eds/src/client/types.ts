// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Wire + domain types, and the one parse point for tolerant shapes
// (design.md, Decision 5). A site-list response is documented to diverge
// between a bare array and `{ sites: [...] }`; `parseSiteList` is the only
// place that distinction is resolved. The OpenAPI contract (12.145.0)
// documents the entries as `{ name }` objects; bare names are still accepted.
export interface SiteListResult {
  readonly sites: readonly string[];
}

export type SiteListEntryWire = string | { readonly name: string };

export type SiteListWire = readonly SiteListEntryWire[] | { readonly sites: readonly SiteListEntryWire[] };

function siteName(entry: SiteListEntryWire): string {
  return typeof entry === "string" ? entry : entry.name;
}

export function parseSiteList(wire: SiteListWire): SiteListResult {
  const entries = "sites" in wire ? wire.sites : wire;
  return { sites: entries.map(siteName) };
}
