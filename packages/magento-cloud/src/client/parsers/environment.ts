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

export const ENVIRONMENT_URL_REQUIRED_HEADERS = ["url"] as const;

/** A single-column, single-row table (see `environment-url.txt`) — the
 * only value a caller needs is that one URL string, not a one-row array. */
export function parseEnvironmentUrl(text: string): string {
  const rows = parseTsvRows(text);
  const records = rowsToRecords(rows, {
    subcommand: "environment:url",
    requiredHeaders: ENVIRONMENT_URL_REQUIRED_HEADERS,
  });
  const [first] = records;
  if (first === undefined) {
    throw new MagentoCloudOutputShapeError({
      subcommand: "environment:url",
      missingHeader: "url",
      headersSeen: [],
    });
  }
  return first.url ?? "";
}
