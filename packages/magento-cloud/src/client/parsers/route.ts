// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `route:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

export const ROUTE_LIST_REQUIRED_HEADERS = ["route", "type", "upstream"] as const;

export interface RouteListRow {
  readonly route: string;
  readonly type: string;
  readonly upstream: string;
}

export function parseRouteList(text: string): readonly RouteListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<RouteListRow>(rows, {
    subcommand: "route:list",
    requiredHeaders: ROUTE_LIST_REQUIRED_HEADERS,
  });
}
