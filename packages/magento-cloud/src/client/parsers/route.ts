// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `route:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

// The header row `route:list` prints for the EXPLICIT column set
// `../commands.ts` asks for (`route,type,to,url`) — `Route Type To URL` — run
// through `normalizeHeaderName` (`URL` -> `url`; pinned in `tsv.test.ts`).
//
// The third column is `To`, not `upstream`: for a `Type: upstream` route it
// names the app it reaches, and for a `Type: redirect` route it names the
// URL it redirects to. Naming it `upstream` would be wrong for half the rows.
export const ROUTE_LIST_REQUIRED_HEADERS = ["route", "type", "to", "url"] as const;

/**
 * The complete set of `route:list` fields a caller may ever receive — an
 * ALLOWLIST, not a description. Every other column the CLI prints is dropped by
 * construction in `parseRouteList` below.
 */
export interface RouteListRow {
  readonly route: string;
  readonly type: string;
  readonly to: string;
  readonly url: string;
}

export function parseRouteList(text: string): readonly RouteListRow[] {
  const rows = parseTsvRows(text);
  const rawRows = rowsToRecords<RouteListRow>(rows, {
    subcommand: "route:list",
    requiredHeaders: ROUTE_LIST_REQUIRED_HEADERS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToRecords` keys a
  // record by EVERY header the CLI printed and the narrow `RouteListRow` is a
  // compile-time claim only, so a spread would serialize whatever extra column
  // came back. This check must not depend on the request being right: it holds
  // even if `--columns` is ever dropped.
  return rawRows.map((raw) => ({
    route: raw.route,
    type: raw.type,
    to: raw.to,
    url: raw.url,
  }));
}
