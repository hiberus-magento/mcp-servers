// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Opaque nextToken cursor walker (design.md, Decision 5). Used only by the
// audit log, which is the sole paginable endpoint in this domain.
// `mcp-core`'s `paginate()`/`paginationSchema` is page-number based;
// applying it to a cursor API would misrepresent the API's shape, so this
// module is deliberately separate. `fetchPage` returns exactly one page and
// never auto-drains — the caller (an `eds_*` tool) decides whether to
// continue.
import type { HttpClient } from "./http.js";

export interface Page<TEntry> {
  readonly entries: readonly TEntry[];
  readonly nextToken?: string;
}

export interface FetchPageOptions {
  readonly nextToken?: string;
}

interface PageWire<TEntry> {
  readonly entries: readonly TEntry[];
  readonly nextToken?: string;
}

export async function fetchPage<TEntry = unknown>(http: HttpClient, path: string, options?: FetchPageOptions): Promise<Page<TEntry>> {
  const fullPath = options?.nextToken !== undefined ? `${path}?nextToken=${encodeURIComponent(options.nextToken)}` : path;
  const response = await http.send({ method: "GET", path: fullPath });
  const body = (await response.json()) as PageWire<TEntry>;
  const page: Page<TEntry> = body.nextToken !== undefined ? { entries: body.entries, nextToken: body.nextToken } : { entries: body.entries };
  return page;
}
