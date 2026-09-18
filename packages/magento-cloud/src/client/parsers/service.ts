// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `service:list` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2).
import { parseTsvRows, rowsToRecords } from "../tsv.js";

// The header row `service:list` prints for the EXPLICIT column set
// `../commands.ts` asks for (`name,type,disk,size`) — `Name Type Disk (MiB)
// Size` — run through `normalizeHeaderName`. Note the third: asking for `disk`
// yields a header cell reading `Disk (MiB)`, which normalizes to `disk_mib`
// (pinned in `tsv.test.ts`). A service with no disk of its own leaves the cell
// empty — that is data, so the column is still required.
export const SERVICE_LIST_REQUIRED_HEADERS = ["name", "type", "disk_mib", "size"] as const;

/**
 * The complete set of `service:list` fields a caller may ever receive — an
 * ALLOWLIST, not a description. Every other column the CLI prints is dropped by
 * construction in `parseServiceList` below.
 */
export interface ServiceListRow {
  readonly name: string;
  readonly type: string;
  readonly disk_mib: string;
  readonly size: string;
}

export function parseServiceList(text: string): readonly ServiceListRow[] {
  const rows = parseTsvRows(text);
  const rawRows = rowsToRecords<ServiceListRow>(rows, {
    subcommand: "service:list",
    requiredHeaders: SERVICE_LIST_REQUIRED_HEADERS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToRecords` keys a
  // record by EVERY header the CLI printed and the narrow `ServiceListRow` is a
  // compile-time claim only, so a spread would serialize whatever extra column
  // came back. This check must not depend on the request being right: it holds
  // even if `--columns` is ever dropped.
  return rawRows.map((raw) => ({
    name: raw.name,
    type: raw.type,
    disk_mib: raw.disk_mib,
    size: raw.size,
  }));
}
