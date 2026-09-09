// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Pagination is the intended interface for any tool that lists a
// paginable collection (design.md, Decision 6). `paginationSchema` is a
// reusable zod fragment meant to be spread into a tool's own input schema;
// `paginate()` slices a fully-materialized collection into the requested
// page and reports the next page number, or `null` on the last page.
//
// Concrete defaults (page >= 1 default 1, pageSize 1..200 default 50) are
// fixed here deliberately — the proposal and design left them unspecified,
// and every tool needs the same shared answer rather than reinventing one.
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextPage: number | null;
}

export function paginate<T>(items: readonly T[], pagination: Pagination): PaginatedResult<T> {
  const start = (pagination.page - 1) * pagination.pageSize;
  const end = start + pagination.pageSize;
  const pageItems = items.slice(start, end);
  const hasMore = end < items.length;
  return {
    items: pageItems,
    nextPage: hasMore ? pagination.page + 1 : null,
  };
}
