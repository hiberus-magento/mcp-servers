// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `db:sql` row mapper (design.md, Decision 4; tasks.md 6.1-6.2).
// Deliberately DIFFERENT from every other parser in this directory: the
// header row is whatever column list the caller's own guarded SELECT
// produced, so there is no fixed `REQUIRED_HEADERS` to declare or
// validate against. `rowsToRecords` is still used with an EMPTY required-
// headers list — the header row is still consumed and used to key each
// data row, just never checked against a fixed shape.
import { parseTsvRows, rowsToRecords } from "../tsv.js";

export function parseDbSqlRows(text: string): readonly Record<string, string>[] {
  const rows = parseTsvRows(text);
  return rowsToRecords(rows, { subcommand: "db:sql", requiredHeaders: [] });
}
