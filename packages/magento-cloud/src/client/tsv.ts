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
 * The ONE place a header cell the CLI printed becomes a record key, so a
 * parser's `REQUIRED_HEADERS` never has to spell a display label. The real
 * CLI prints a header row for humans: Capitalised, spaced, and punctuated
 * (`ID`, `Disk (MiB)`, `Allocated disk`, `% used`), so an exact
 * case-sensitive match against it rejected genuine output.
 *
 * `%` becomes the WORD `percent` before anything else, because collapsing
 * it as punctuation would silently turn `% used` into `used` — colliding
 * with any real `Used` column instead of failing, which is the kind of
 * quiet mis-key this whole module exists to prevent. Everything after that
 * is mechanical: lowercase, every run of non-alphanumerics to a single
 * `_`, and no leading or trailing `_`.
 */
export function normalizeHeaderName(header: string): string {
  return header
    .replace(/%/g, " percent ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Maps data rows to plain objects keyed by the NORMALIZED header the CLI
 * actually emitted (row 0) — never a positional index, so a column
 * reordering or an appended column is inert. Missing `requiredHeaders`
 * (themselves already in normalized form) throw
 * `MagentoCloudOutputShapeError` naming the subcommand, the missing
 * header, and every header actually seen — reported VERBATIM, as the CLI
 * printed it, since that is what a maintainer re-capturing the fixture
 * will be looking at. An unrecognized EXTRA header passes through
 * untouched: strict on our contract, tolerant on theirs.
 */
export function rowsToRecords<T = Record<string, string>>(
  rows: readonly (readonly string[])[],
  options: RowsToRecordsOptions,
): readonly T[] {
  const [header, ...dataRows] = rows;
  const headersSeen = header ?? [];
  const normalizedHeaders = headersSeen.map(normalizeHeaderName);

  for (const requiredHeader of options.requiredHeaders) {
    if (!normalizedHeaders.includes(requiredHeader)) {
      throw new MagentoCloudOutputShapeError({
        subcommand: options.subcommand,
        missingHeader: requiredHeader,
        headersSeen,
      });
    }
  }

  return dataRows.map((dataRow) => {
    const record: Record<string, string> = {};
    normalizedHeaders.forEach((columnName, columnIndex) => {
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
 * The OTHER shape the CLI's `:info`/`:get` subcommands emit
 * (`auth-info.txt`, `project-info.txt`, `environment-info.txt`,
 * `activity-get.txt`, `variable-get.txt`): a literal `Property\tValue`
 * header row, then one `field\tvalue` pair per line. Reuses the same
 * missing-key error contract as `rowsToRecords`, naming the subcommand,
 * the missing key, and every key actually seen.
 *
 * Two kinds of line are deliberately NOT data:
 *
 * - the leading `Property\tValue` header. Ingesting it put a literal
 *   `{ "Property": "Value" }` entry in every `:info` result an agent saw.
 * - anything that is not a TOP-LEVEL pair. A nested value (`sizing`,
 *   `attributes`, `crons`) renders as a bare key line followed by INDENTED
 *   YAML continuation lines, and a continuation line's own `key: value`
 *   colon syntax carries no tab at all. This function claims only the flat
 *   scalars; reconstructing the nested blocks would mean a YAML parser,
 *   and no caller here needs one. The rule is therefore structural rather
 *   than a guess at key names: a row is data only when it has at least two
 *   cells and its key cell starts with a non-space character.
 */
export function rowsToKeyValueRecord<T = Record<string, string>>(
  rows: readonly (readonly string[])[],
  options: RowsToKeyValueRecordOptions,
): T {
  const record: Record<string, string> = {};
  const [firstRow, ...restRows] = rows;
  const isHeaderRow = firstRow !== undefined && firstRow[0] === "Property" && firstRow[1] === "Value";
  const dataRows = isHeaderRow ? restRows : rows;

  for (const row of dataRows) {
    const [key, value] = row;
    if (key === undefined || value === undefined || key.length === 0 || /^\s/.test(key)) {
      continue;
    }
    record[key] = value;
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
