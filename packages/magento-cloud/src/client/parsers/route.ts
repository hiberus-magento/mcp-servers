// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `route:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

// The third column is `To`, not `upstream`: for a `Type: upstream` route it
// names the app it reaches, and for a `Type: redirect` route it names the
// URL it redirects to. Naming it `upstream` would be wrong for half the rows.
export const ROUTE_LIST_REQUIRED_HEADERS = ["route", "type", "to"] as const;

export interface RouteListRow {
  readonly route: string;
  readonly type: string;
  readonly to: string;
}

export function parseRouteList(text: string): readonly RouteListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<RouteListRow>(rows, {
    subcommand: "route:list",
    requiredHeaders: ROUTE_LIST_REQUIRED_HEADERS,
  });
}
