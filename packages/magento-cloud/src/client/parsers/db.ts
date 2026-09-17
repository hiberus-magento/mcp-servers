// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `db:size` row mapper over `../tsv.ts` (design.md, Decision 4; tasks.md
// 6.1-6.2). `db:sql` is intentionally NOT here — see `db-sql.ts`.
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseTsvRows, rowsToRecords } from "../tsv.js";

export const DB_SIZE_REQUIRED_HEADERS = ["usedMb", "limitMb", "percentUsed"] as const;

export interface DbSizeRecord {
  readonly usedMb: string;
  readonly limitMb: string;
  readonly percentUsed: string;
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
