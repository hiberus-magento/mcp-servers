// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `project:list` / `project:info` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2). Each declares its OWN required-columns
// constant, so a drift affecting one subcommand's shape never masks a
// drift in another's.
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

export const PROJECT_LIST_REQUIRED_HEADERS = ["id", "title", "region"] as const;

export interface ProjectListRow {
  readonly id: string;
  readonly title: string;
  readonly region: string;
}

export function parseProjectList(text: string): readonly ProjectListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<ProjectListRow>(rows, {
    subcommand: "project:list",
    requiredHeaders: PROJECT_LIST_REQUIRED_HEADERS,
  });
}

export const PROJECT_INFO_REQUIRED_KEYS = ["id", "title", "region"] as const;

export interface ProjectInfoRecord {
  readonly id: string;
  readonly title: string;
  readonly region: string;
}

export function parseProjectInfo(text: string): ProjectInfoRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<ProjectInfoRecord>(rows, {
    subcommand: "project:info",
    requiredKeys: PROJECT_INFO_REQUIRED_KEYS,
  });
}
