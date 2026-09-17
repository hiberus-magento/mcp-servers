// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A quote-aware, `\t`-delimited row parser (design.md, Decision 4;
// magento-cloud-client spec, "Quoted-Field TSV Parsing"; tasks.md
// 3.7-3.9). The CLI's `renderCsv($rows, $header, "\t")` delegates to a
// real CSV formatter, so a value containing a tab or a newline arrives
// QUOTED — a naive `split("\t")` is the WRONG approach
// (`tsv.test.ts`'s "naive split" describe block proves it against the
// exact fixture corpus). `"` opens/closes a field, `""` inside a quoted
// field is one literal quote character, and a delimiter or newline inside
// quotes is data, never a row/column boundary — RFC4180 semantics with a
// tab delimiter instead of a comma.
import { MagentoCloudOutputShapeError } from "./errors.js";

export function parseTsvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Swallow a CR that precedes a LF; a bare CR (no following LF) is
      // treated as data — real CLI output uses `\n` line endings.
      if (text[i + 1] === "\n") {
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // A trailing newline is the common case (every canned fixture ends with
  // one); only flush a final partial row when there is unterminated
  // content left to flush.
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}

export interface RowsToRecordsOptions {
  readonly subcommand: string;
  readonly requiredHeaders: readonly string[];
}

/**
 * Maps data rows to plain objects keyed by the HEADER the CLI actually
 * emitted (row 0) — never a positional index, so a column reordering or an
 * appended column is inert. Missing `requiredHeaders` throw
 * `MagentoCloudOutputShapeError` naming the subcommand, the missing
 * header, and every header actually seen. An unrecognized EXTRA header
 * passes through untouched: strict on our contract, tolerant on theirs.
 */
export function rowsToRecords<T = Record<string, string>>(
  rows: readonly (readonly string[])[],
  options: RowsToRecordsOptions,
): readonly T[] {
  const [header, ...dataRows] = rows;
  const headersSeen = header ?? [];

  for (const requiredHeader of options.requiredHeaders) {
    if (!headersSeen.includes(requiredHeader)) {
      throw new MagentoCloudOutputShapeError({
        subcommand: options.subcommand,
        missingHeader: requiredHeader,
        headersSeen,
      });
    }
  }

  return dataRows.map((dataRow) => {
    const record: Record<string, string> = {};
    headersSeen.forEach((columnName, columnIndex) => {
      record[columnName] = dataRow[columnIndex] ?? "";
    });
    // `T` is caller-declared (e.g. `ProjectListRow`) and can only ever
    // widen what this function actually builds — a single, localized,
    // well-understood generic cast here, rather than an unsafe `as unknown
    // as X` at every call site.
    return record as unknown as T;
  });
}

export interface RowsToKeyValueRecordOptions {
  readonly subcommand: string;
  readonly requiredKeys: readonly string[];
}

/**
 * The OTHER shape the CLI's `:info`/`:get` subcommands emit — no header
 * row at all; every row IS a `field\tvalue` pair (`auth-info.txt`,
 * `project-info.txt`, `environment-info.txt`, `activity-get.txt`,
 * `variable-get.txt`). Reuses the same missing-key error contract as
 * `rowsToRecords`, naming the subcommand, the missing key, and every key
 * actually seen.
 */
export function rowsToKeyValueRecord<T = Record<string, string>>(
  rows: readonly (readonly string[])[],
  options: RowsToKeyValueRecordOptions,
): T {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const [key, value] = row;
    if (key !== undefined) {
      record[key] = value ?? "";
    }
  }

  const keysSeen = Object.keys(record);
  for (const requiredKey of options.requiredKeys) {
    if (!(requiredKey in record)) {
      throw new MagentoCloudOutputShapeError({
        subcommand: options.subcommand,
        missingHeader: requiredKey,
        headersSeen: keysSeen,
      });
    }
  }

  return record as unknown as T;
}
