// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `service:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

// `Disk (MiB)` normalizes to `disk_mib` (`../tsv.ts`'s
// `normalizeHeaderName`). A service with no disk of its own leaves the cell
// empty — that is data, so the column is still required.
export const SERVICE_LIST_REQUIRED_HEADERS = ["name", "type", "disk_mib", "size"] as const;

export interface ServiceListRow {
  readonly name: string;
  readonly type: string;
  readonly disk_mib: string;
  readonly size: string;
}

export function parseServiceList(text: string): readonly ServiceListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<ServiceListRow>(rows, {
    subcommand: "service:list",
    requiredHeaders: SERVICE_LIST_REQUIRED_HEADERS,
  });
}
