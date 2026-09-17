// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `ListPriceBooks` — `Q_PBOOKS` (exploration.md). Admin track, the ONLY
// cursor-paginated query in this client (design.md, Decision 4): only
// `ListPriceBooksResult` is a `ScrollPage<PriceBookResult>` (`cursor.ts`),
// and `scrollId` is passed through verbatim, never auto-drained.
import type { AdminTransport } from "../http.js";
import { parseListPriceBooksResult, type ListPriceBooksResult } from "../types.js";

const LIST_PRICE_BOOKS_DOCUMENT = `query ListPriceBooks($size: Int, $searchTerm: String, $scrollId: String) {
  priceBooks(size: $size, searchTerm: $searchTerm, scrollId: $scrollId) {
    items {
      id
      name
      currency
      level
      parentIds
    }
    scrollId
  }
}`;

export interface ListPriceBooksOptions {
  readonly size?: number;
  readonly searchTerm?: string;
  readonly scrollId?: string;
}

export async function listPriceBooks(transport: AdminTransport, options: ListPriceBooksOptions): Promise<ListPriceBooksResult> {
  return transport.execute({
    track: "admin",
    document: LIST_PRICE_BOOKS_DOCUMENT,
    variables: {
      ...(options.size !== undefined ? { size: options.size } : {}),
      ...(options.searchTerm !== undefined ? { searchTerm: options.searchTerm } : {}),
      ...(options.scrollId !== undefined ? { scrollId: options.scrollId } : {}),
    },
    parse: (data) => parseListPriceBooksResult(data, "ListPriceBooks"),
  });
}
