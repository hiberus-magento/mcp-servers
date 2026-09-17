// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `SearchCatalog` — wraps `productSearch` (exploration.md). Merchandising
// track, Tier A (design.md, Decision 0): no credential for an unprotected
// view, and this transport has no `tokenProvider` field to read one from.
import type { MerchandisingRequestContext, MerchandisingTransport } from "../http.js";
import { parseSearchCatalogResult, type SearchCatalogResult } from "../types.js";

const SEARCH_CATALOG_DOCUMENT = `query SearchCatalog($phrase: String, $pageSize: Int, $currentPage: Int) {
  productSearch(phrase: $phrase, page_size: $pageSize, current_page: $currentPage) {
    total_count
    facets {
      attribute
      title
      buckets {
        value
        count
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
  readonly phrase?: string;
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
