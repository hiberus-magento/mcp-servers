// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Synthetic organization, site, and domain constants shared across every
// fixture and example in this repository (design.md, Decision 6; this
// repository is public — no real customer identifier may ever appear).
// Consumed by `catalog-views.csv` and by future domain packages' own
// fixtures, so there is exactly one place these values are defined.
export const SYNTHETIC_ORG = "acme-demo-org" as const;

export const SYNTHETIC_SITES = ["acme-demo-site-eu", "acme-demo-site-us"] as const;

export const SYNTHETIC_LOCALES = ["en_US", "es_ES", "fr_FR"] as const;

export const SYNTHETIC_VERTICALS = ["outdoor-gear", "home-decor", "office-supplies"] as const;

export const SYNTHETIC_DOMAIN = "example-domain" as const;

// aco-package additions (design.md, Decision 5): the `catalog-views.csv`
// additive migration appends `ac_view_id`, `ac_price_book_id`, and
// `currency` columns, and every value in those columns is drawn from these
// constants — never invented per file.
export const SYNTHETIC_CURRENCIES = ["EUR", "USD"] as const;
export const SYNTHETIC_AC_VIEW_ID_PREFIX = "acv-demo-" as const;
export const SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX = "acpb-demo-" as const;

export type SyntheticSite = (typeof SYNTHETIC_SITES)[number];
export type SyntheticLocale = (typeof SYNTHETIC_LOCALES)[number];
export type SyntheticVertical = (typeof SYNTHETIC_VERTICALS)[number];
export type SyntheticCurrency = (typeof SYNTHETIC_CURRENCIES)[number];
