// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `activity:list` / `activity:get` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2). `activity:log`'s output is plain
// deployment-log text (`test/fake-bin/fixtures/activity-log.txt`), not a
// tabular/key-value shape, so it deliberately has no parser here — a
// caller passes its raw stdout through unparsed.
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

// `activity:list` has NO `Type` column. It reports what happened
// (`Description`), how far it got (`Progress`), whether it finished
// (`State`), and how it finished (`Result`).
export const ACTIVITY_LIST_REQUIRED_HEADERS = ["id", "created", "description", "progress", "state", "result"] as const;

export interface ActivityListRow {
  readonly id: string;
  readonly created: string;
  readonly description: string;
  readonly progress: string;
  readonly state: string;
  readonly result: string;
}

export function parseActivityList(text: string): readonly ActivityListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<ActivityListRow>(rows, {
    subcommand: "activity:list",
    requiredHeaders: ACTIVITY_LIST_REQUIRED_HEADERS,
  });
}

export const ACTIVITY_GET_REQUIRED_KEYS = ["id", "type", "state"] as const;

/**
 * The complete set of `activity:get` fields a caller may ever receive — an
 * ALLOWLIST, not a description. Everything else the CLI prints is dropped by
 * construction in `parseActivityGet` below.
 *
 * Only `ACTIVITY_GET_REQUIRED_KEYS` are guaranteed present, so every other
 * field is honestly `string | undefined` rather than `string`.
 */
export interface ActivityGetRecord {
  readonly id: string;
  readonly type: string;
  readonly state: string;
  readonly description: string | undefined;
  readonly result: string | undefined;
  readonly completion_percent: string | undefined;
  readonly created_at: string | undefined;
  readonly completed_at: string | undefined;
}

export function parseActivityGet(text: string): ActivityGetRecord {
  const rows = parseTsvRows(text);
  const raw = rowsToKeyValueRecord<ActivityGetRecord>(rows, {
    subcommand: "activity:get",
    requiredKeys: ACTIVITY_GET_REQUIRED_KEYS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToKeyValueRecord`
  // returns EVERY top-level pair the CLI printed and the narrow `T` is a
  // compile-time claim only, so a spread would put all of it into a model's
  // context the moment the result is serialized.
  //
  // `parameters`, `text` and `commands` are the notable drops: each carries
  // an ARBITRARY payload — whatever the activity happened to be handed, which
  // is exactly what cannot be reasoned about ahead of time. What survives says
  // what the activity was and how it went.
  return {
    id: raw.id,
    type: raw.type,
    state: raw.state,
    description: raw.description,
    result: raw.result,
    completion_percent: raw.completion_percent,
    created_at: raw.created_at,
    completed_at: raw.completed_at,
  };
}
