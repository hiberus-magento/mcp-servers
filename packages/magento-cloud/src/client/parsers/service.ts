// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `service:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

export const SERVICE_LIST_REQUIRED_HEADERS = ["name", "type"] as const;

export interface ServiceListRow {
  readonly name: string;
  readonly type: string;
}

export function parseServiceList(text: string): readonly ServiceListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<ServiceListRow>(rows, {
    subcommand: "service:list",
    requiredHeaders: SERVICE_LIST_REQUIRED_HEADERS,
  });
}
