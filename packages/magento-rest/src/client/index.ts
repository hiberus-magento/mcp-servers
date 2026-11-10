// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The public surface of `client/` — the only module the rest of the package
// (and any other package) may import from it; the client-boundary lint rule
// forbids a deep import. Pure by construction: it reads no environment,
// writes no output and never exits the process. `fetch`, `now`, `sleep` and
// the base URL are injected, so every environment read lives in the adapter
// layer (`tools/`).
import { createRestTransport, type RestTransportDeps } from "./http.js";
import { buildSearchCriteria, MAX_PAGE_SIZE, type SearchCriteriaInput } from "./search-criteria.js";

export { restPath } from "./paths.js";
export { normalizeCountry } from "./countries.js";
export { formatDay, formatMagentoTimestamp, isDateRangeExpression, parseDateRange, type DateRange } from "./date-range.js";
export { MagentoRestError, type MagentoRestErrorKind } from "./errors.js";
export { CONDITION_TYPES, DEFAULT_PAGE_SIZE, FIELD_NAME_PATTERN, MAX_PAGE_SIZE, buildSearchCriteria } from "./search-criteria.js";
export type { ConditionType, SearchCriteriaInput, SearchFilter, SortDirection } from "./search-criteria.js";
export type { RestTransportDeps } from "./http.js";

/** Default and hard ceiling on pages one `getAllPages` call may fetch. 10 x 100 = 1,000 records by default. */
export const DEFAULT_MAX_PAGES = 10;
export const MAX_PAGES_CEILING = 50;

export interface SearchResult {
  readonly items: readonly unknown[];
  readonly totalCount: number;
}

export interface AllPagesResult extends SearchResult {
  /** True when the page cap stopped the walk before Magento ran out of records. */
  readonly truncated: boolean;
}

export interface MagentoRestClient {
  get(path: string, query?: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  put(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  /** One bounded `searchCriteria` page of a list endpoint (`{ items, total_count }`). */
  search(path: string, criteria: SearchCriteriaInput): Promise<SearchResult>;
  /** Walks pages of 100 up to `maxPages`; never unbounded. */
  getAllPages(path: string, criteria: SearchCriteriaInput, options?: { readonly maxPages?: number }): Promise<AllPagesResult>;
}

function readSearchBody(body: unknown): SearchResult {
  if (body === null || typeof body !== "object") {
    return { items: [], totalCount: 0 };
  }
  const items = "items" in body && Array.isArray(body.items) ? (body.items as readonly unknown[]) : [];
  const totalCount = "total_count" in body && typeof body.total_count === "number" ? body.total_count : items.length;
  return { items, totalCount };
}

export function createMagentoRestClient(deps: RestTransportDeps): MagentoRestClient {
  const transport = createRestTransport(deps);

  async function search(path: string, criteria: SearchCriteriaInput): Promise<SearchResult> {
    return readSearchBody(await transport.request({ method: "GET", path, query: buildSearchCriteria(criteria) }));
  }

  return {
    get: (path, query) => transport.request({ method: "GET", path, ...(query !== undefined ? { query } : {}) }),
    post: (path, body) => transport.request({ method: "POST", path, ...(body !== undefined ? { body } : {}) }),
    put: (path, body) => transport.request({ method: "PUT", path, ...(body !== undefined ? { body } : {}) }),
    delete: (path) => transport.request({ method: "DELETE", path }),
    search,
    async getAllPages(path, criteria, options) {
      const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_CEILING) {
        throw new Error(`getAllPages: maxPages must be an integer from 1 to ${MAX_PAGES_CEILING}`);
      }
      const items: unknown[] = [];
      let totalCount = 0;
      for (let currentPage = 1; currentPage <= maxPages; currentPage += 1) {
        const result = await search(path, { ...criteria, pageSize: MAX_PAGE_SIZE, currentPage });
        items.push(...result.items);
        totalCount = result.totalCount;
        const shortPage = result.items.length < MAX_PAGE_SIZE;
        if (shortPage || items.length >= totalCount) {
          return { items, totalCount, truncated: false };
        }
      }
      return { items, totalCount, truncated: true };
    },
  };
}
