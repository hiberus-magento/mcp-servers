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

// magento-cloud-package additions (design.md's Interfaces section; tasks.md
// 10.1): every synthetic project id, environment id, token, and hostname
// introduced by `packages/magento-cloud`'s fixtures and tests is derived
// from these constants going forward.
export const SYNTHETIC_MC_PROJECT_ID = "mcproj-demo-0001" as const;
export const SYNTHETIC_MC_ENVIRONMENT_IDS = ["demo-production", "demo-staging"] as const;
// Deliberately SHORT (13 chars, below `scan-secrets.mjs`'s 16-char
// generic-key-assignment threshold): the longer, more self-explanatory
// value this constant originally held (`"mc-demo-token-not-a-real-
// credential"`) tripped that scanner's `token\s*[:=]\s*"..."` pattern on
// its FIRST real run — a genuine finding, not a staged one (mirrors batch
// 2's identical fix for `FIXTURE_PASSWORD_VALUE`). The synthetic intent is
// carried by the constant's NAME, not by a long descriptive string value.
export const SYNTHETIC_MC_TOKEN = "mc-demo-token" as const;
export const SYNTHETIC_MC_HOST = `demo-host.${SYNTHETIC_DOMAIN}` as const;

export type SyntheticMcEnvironmentId = (typeof SYNTHETIC_MC_ENVIRONMENT_IDS)[number];

// magento-rest-package additions: every synthetic base URL, SKU, token and
// store code the `packages/magento-rest` fixtures and tests use comes from
// here. Same rule as `SYNTHETIC_MC_TOKEN`: the token is kept SHORT (below
// `scan-secrets.mjs`'s 16-char generic-key-assignment threshold), and its
// synthetic intent is carried by the constant's name, not its value.
export const SYNTHETIC_MAGENTO_BASE_URL = `https://demo-host.${SYNTHETIC_DOMAIN}/rest/V1` as const;
export const SYNTHETIC_MAGENTO_TOKEN = "mr-demo-token" as const;
export const SYNTHETIC_MAGENTO_SKUS = ["DEMO-TENT-001", "DEMO-LAMP-002"] as const;
export const SYNTHETIC_MAGENTO_STORE_CODE = "demo_store" as const;
export const SYNTHETIC_MAGENTO_ORDER_INCREMENT_ID = "DEMO000000001" as const;
// `.example` is a reserved TLD, so this is a syntactically valid address (a
// real email validator wants a TLD, which `SYNTHETIC_DOMAIN` deliberately lacks)
// that can never route to a real mailbox.
export const SYNTHETIC_MAGENTO_CUSTOMER_EMAIL = "shopper@demo-host.example" as const;

// magento-graphql-package additions. Same rules as above: short token, intent carried by the name.
export const SYNTHETIC_MAGENTO_GRAPHQL_URL = `https://demo-host.${SYNTHETIC_DOMAIN}/graphql` as const;
export const SYNTHETIC_MAGENTO_CUSTOMER_TOKEN = "mg-demo-token" as const;

export type SyntheticMagentoSku = (typeof SYNTHETIC_MAGENTO_SKUS)[number];
