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

// The attribute is NOT a query variable: `productSearch` takes no
// per-attribute argument (its arguments are `phrase`/`page_size`/
// `current_page`, as `search.ts`'s sibling document shows), so the one
// request returns every facet and `getFacetValues` selects the requested
// one from the result below. The document used to declare `$attribute` and
// never reference it, which is invalid against every GraphQL server — the
// live service answered `Variable "$attribute" is never used.` and ran
// nothing. Declaring it was the mistake, not forgetting to use it.
const FACET_VALUES_DOCUMENT = `query FacetValues {
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
