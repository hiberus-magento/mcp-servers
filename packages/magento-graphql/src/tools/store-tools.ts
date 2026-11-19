// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Store-level reads. `get_store_config` selects a fixed list of display and locale settings:
// the `storeConfig` type also carries secure URLs and payment-adjacent flags that an agent has
// no use for, so they are simply not asked for.
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf } from "./inputs.js";

const noInput = z.object({ ...context }).strict();

const STORE_CONFIG = `
query GetStoreConfig {
  storeConfig {
    store_code
    store_name
    store_group_code
    store_group_name
    website_code
    website_name
    locale
    timezone
    base_currency_code
    default_display_currency_code
    weight_unit
    root_category_uid
    base_url
    base_link_url
    base_media_url
    product_url_suffix
    category_url_suffix
    cms_home_page
    catalog_default_sort_by
    grid_per_page
    list_per_page
    list_mode
  }
}`;

const AVAILABLE_STORES = `
query GetAvailableStores {
  availableStores {
    store_code
    store_name
    store_group_code
    website_code
    locale
    base_currency_code
    default_display_currency_code
    is_default_store
    is_default_store_group
  }
}`;

const COUNTRIES = "query GetCountries { countries { id two_letter_abbreviation three_letter_abbreviation full_name_english } }";
const COUNTRY = "query GetCountry($id: String) { country(id: $id) { id full_name_english available_regions { id code name } } }";
const CURRENCY = "query GetCurrency { currency { base_currency_code default_display_currency_code available_currency_codes exchange_rates { currency_to rate } } }";

export function storeTools({ readTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_get_store_config",
      description: "Use this to read the current store view's display settings: codes and names, locale, timezone, currencies, weight unit, base URLs, URL suffixes and catalog paging defaults.",
      input: noInput,
      document: STORE_CONFIG,
      pick: "storeConfig",
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_available_stores",
      description: "Use this to list the store views the storefront offers, with their codes, website and store group, locale and currencies — the values the `store` argument takes.",
      input: noInput,
      document: AVAILABLE_STORES,
      pick: "availableStores",
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_countries",
      description: "Use this to list the countries the store knows, with ISO codes and English names.",
      input: noInput,
      document: COUNTRIES,
      pick: "countries",
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_country",
      description: "Use this to read one country with its regions (id, code, name), by its two-letter code.",
      input: z.object({ id: z.string().regex(/^[A-Z]{2}$/, "a two-letter upper-case country code, e.g. ES").describe("The two-letter country code, e.g. ES."), ...context }).strict(),
      document: COUNTRY,
      pick: "country",
      variables: (a) => ({ id: a.id }),
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_currency",
      description: "Use this to read the base and display currency, the currencies the store view allows, and the exchange rates.",
      input: noInput,
      document: CURRENCY,
      pick: "currency",
      context: contextOf,
    }),
  ];
}
