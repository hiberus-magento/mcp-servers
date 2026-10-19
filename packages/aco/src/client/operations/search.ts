// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `SearchCatalog` — wraps `productSearch` (exploration.md). Merchandising
// track, Tier A (design.md, Decision 0): no credential for an unprotected
// view, and this transport has no `tokenProvider` field to read one from.
import type { MerchandisingRequestContext, MerchandisingTransport } from "../http.js";
import { parseSearchCatalogResult, type SearchCatalogResult } from "../types.js";

// `Aggregation.buckets` is of the INTERFACE type `Bucket`, whose only
// common field is `title`. This document asked for `value` and `count`:
// `value` is on no implementation at all, and `count` is reachable only
// through an inline fragment, so EVERY selected subfield was invalid — which
// is what the live `Field "buckets" of type "Aggregation" must have a
// selection of subfields` means here, not a missing selection set. The four
// implementations are `ScalarBucket` (count/id/title), `RangeBucket`
// (count/from/to/title), `CategoryBucket` (count/id/path/title) and
// `StatsBucket` (max/min/title) — `StatsBucket` carries no `count` at all,
// which is why `SearchCatalogBucket.count` is optional rather than
// defaulted (types.ts).
//
// `phrase` is `String!` on `productSearch`, not `String`: declaring it
// nullable answers `Variable "$phrase" of type "String" used in position
// expecting type "String!"`, which fails the whole query — this document
// never ran anywhere until that was fixed. `page_size`/`current_page` are
// nullable and stay optional (the live validation error named `$phrase`
// alone, and GraphQL validation reports every bad variable position in one
// response, so the other two are in accepted positions).
const SEARCH_CATALOG_DOCUMENT = `query SearchCatalog($phrase: String!, $pageSize: Int, $currentPage: Int) {
  productSearch(phrase: $phrase, page_size: $pageSize, current_page: $currentPage) {
    total_count
    facets {
      attribute
      title
      buckets {
        title
        ... on ScalarBucket { count }
        ... on RangeBucket { count from to }
        ... on CategoryBucket { count }
        ... on StatsBucket { min max }
      }
    }
    items {
      productView {
        attributes(roles: []) {
          name
          value
        }
      }
    }
  }
}`;

export interface SearchCatalogOptions extends MerchandisingRequestContext {
  /**
   * Required, because `$phrase` is `String!`: `JSON.stringify` drops an
   * `undefined` variable from the posted body, and a missing required
   * variable is a server-side validation error rather than "search
   * everything". `aco_search_catalog` already requires a non-empty phrase.
   */
  readonly phrase: string;
  readonly pageSize?: number;
  readonly currentPage?: number;
}

export async function searchCatalog(transport: MerchandisingTransport, options: SearchCatalogOptions): Promise<SearchCatalogResult> {
  return transport.execute(
    {
      track: "merchandising",
      document: SEARCH_CATALOG_DOCUMENT,
      variables: { phrase: options.phrase, pageSize: options.pageSize, currentPage: options.currentPage },
      parse: (data) => parseSearchCatalogResult(data),
    },
    options,
  );
}
