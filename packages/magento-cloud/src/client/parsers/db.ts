// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `db:size` row mapper over `../tsv.ts` (design.md, Decision 4; tasks.md
// 6.1-6.2). `db:sql` is intentionally NOT here — see `db-sql.ts`.
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseTsvRows, rowsToRecords } from "../tsv.js";

// `Allocated disk` and `Estimated usage` are BYTE counts, not megabytes, and
// `% used` is an integer percentage — the names carry that, so a caller
// cannot mistake a byte count for the megabyte figure the old `usedMb`
// promised. Only stdout is parsed: the CLI's progress text and its
// deprecation notice go to stderr.
export const DB_SIZE_REQUIRED_HEADERS = ["allocated_disk", "estimated_usage", "percent_used"] as const;

export interface DbSizeRecord {
  readonly allocated_disk: string;
  readonly estimated_usage: string;
  readonly percent_used: string;
}

export function parseDbSize(text: string): DbSizeRecord {
  const rows = parseTsvRows(text);
  const records = rowsToRecords<DbSizeRecord>(rows, {
    subcommand: "db:size",
    requiredHeaders: DB_SIZE_REQUIRED_HEADERS,
  });
  const [first] = records;
  if (first === undefined) {
    throw new MagentoCloudOutputShapeError({
      subcommand: "db:size",
      missingHeader: DB_SIZE_REQUIRED_HEADERS[0],
      headersSeen: [],
    });
  }
  return first;
}
