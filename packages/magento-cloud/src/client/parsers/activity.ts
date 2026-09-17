// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `activity:list` / `activity:get` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2). `activity:log`'s output is plain
// deployment-log text (`test/fake-bin/fixtures/activity-log.txt`), not a
// tabular/key-value shape, so it deliberately has no parser here — a
// caller passes its raw stdout through unparsed.
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

export const ACTIVITY_LIST_REQUIRED_HEADERS = ["id", "type", "state", "created"] as const;

export interface ActivityListRow {
  readonly id: string;
  readonly type: string;
  readonly state: string;
  readonly created: string;
}

export function parseActivityList(text: string): readonly ActivityListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<ActivityListRow>(rows, {
    subcommand: "activity:list",
    requiredHeaders: ACTIVITY_LIST_REQUIRED_HEADERS,
  });
}

export const ACTIVITY_GET_REQUIRED_KEYS = ["id", "type", "state"] as const;

export interface ActivityGetRecord {
  readonly id: string;
  readonly type: string;
  readonly state: string;
}

export function parseActivityGet(text: string): ActivityGetRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<ActivityGetRecord>(rows, {
    subcommand: "activity:get",
    requiredKeys: ACTIVITY_GET_REQUIRED_KEYS,
  });
}
