// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `FacetValues` — its own named query, distinct from `SearchCatalog` even
// though both wrap `productSearch` (design.md, Decision 3), so the fetch
// double can key on the difference and so `aco_get_facet_values` remains a
// single, always-one-request call. `FacetValuesResult` is a closed union —
// a non-facetable attribute returns `{ facetable: false, reason }` and this
// function issues NO additional request. There is no page-sampling loop
// anywhere in this module (client-layer structural boundary #1): the return
// type has nowhere to put sampled values, and adding one would be a visible
// named diff to an exported type, never a quiet extra `await`.
import type { MerchandisingRequestContext, MerchandisingTransport } from "../http.js";
import { parseFacetValuesWire, type FacetValuesResult } from "../types.js";

const FACET_VALUES_DOCUMENT = `query FacetValues($attribute: String!) {
  productSearch(phrase: "", page_size: 0, current_page: 1) {
    facets {
      attribute
      buckets {
        value
        count
      }
    }
  }
}`;

export interface FacetValuesOptions extends MerchandisingRequestContext {
  readonly attribute: string;
}

export async function getFacetValues(transport: MerchandisingTransport, options: FacetValuesOptions): Promise<FacetValuesResult> {
  const facets = await transport.execute(
    {
      track: "merchandising",
      document: FACET_VALUES_DOCUMENT,
      variables: { attribute: options.attribute },
      parse: (data) => parseFacetValuesWire(data),
    },
    options,
  );

  const match = facets.find((facet) => facet.attribute === options.attribute);
  const buckets = match?.buckets ?? [];
  const values = buckets.filter((bucket): bucket is { readonly value: string; readonly count: number } => bucket.value !== undefined && bucket.count !== undefined);

  if (values.length === 0) {
    return { facetable: false, reason: `No facet bucket data was returned for attribute "${options.attribute}".` };
  }
  return { facetable: true, values };
}
