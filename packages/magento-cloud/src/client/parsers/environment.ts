// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `environment:list` / `environment:info` / `environment:url` row mappers
// over `../tsv.ts` (design.md, Decision 4; tasks.md 6.1-6.2).
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

export const ENVIRONMENT_LIST_REQUIRED_HEADERS = ["id", "status", "type", "title"] as const;

export interface EnvironmentListRow {
  readonly id: string;
  readonly status: string;
  readonly type: string;
  readonly title: string;
}

export function parseEnvironmentList(text: string): readonly EnvironmentListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<EnvironmentListRow>(rows, {
    subcommand: "environment:list",
    requiredHeaders: ENVIRONMENT_LIST_REQUIRED_HEADERS,
  });
}

export const ENVIRONMENT_INFO_REQUIRED_KEYS = ["id", "status", "type"] as const;

export interface EnvironmentInfoRecord {
  readonly id: string;
  readonly status: string;
  readonly type: string;
}

export function parseEnvironmentInfo(text: string): EnvironmentInfoRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<EnvironmentInfoRecord>(rows, {
    subcommand: "environment:info",
    requiredKeys: ENVIRONMENT_INFO_REQUIRED_KEYS,
  });
}

/**
 * NOT a TSV read. `environment:url` rejects `--format` outright ("The
 * `--format` option does not exist."), so it is invoked with `--pipe`
 * instead (`../commands.ts`), which prints one bare URL per line with no
 * header row at all. There is nothing here to key by name, so there are no
 * `REQUIRED_HEADERS` either — a blank line is the only thing discarded.
 */
export function parseEnvironmentUrls(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The first URL the CLI printed — an environment routinely has several
 * (`--pipe` prints them all), and the CLI prints the primary one first.
 * Throws rather than returning `""` when there is none, so "no URL" can
 * never be mistaken for a URL that failed to parse.
 */
export function parseEnvironmentUrl(text: string): string {
  const [first] = parseEnvironmentUrls(text);
  if (first === undefined) {
    throw new MagentoCloudOutputShapeError({
      subcommand: "environment:url",
      missingHeader: "url",
      headersSeen: [],
    });
  }
  return first;
}
