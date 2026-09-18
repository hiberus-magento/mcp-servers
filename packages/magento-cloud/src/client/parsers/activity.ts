// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `activity:list` / `activity:get` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2). `activity:log`'s output is plain
// deployment-log text (`test/fake-bin/fixtures/activity-log.txt`), not a
// tabular/key-value shape, so it deliberately has no parser here — a
// caller passes its raw stdout through unparsed.
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

// The header row `activity:list` prints for the EXPLICIT column set
// `../commands.ts` asks for — `ID Created Type State Result Progress Completed
// Build time (s) Deploy time (s) Exec time (s) Wait time (s)` — run through
// `normalizeHeaderName` (`Build time (s)` -> `build_time_s`; pinned in
// `tsv.test.ts`). The CLI's own DEFAULT columns are a different set, and
// asking for these is what keeps `Description` out of the output entirely.
export const ACTIVITY_LIST_REQUIRED_HEADERS = [
  "id",
  "created",
  "type",
  "state",
  "result",
  "progress",
  "completed",
  "build_time_s",
  "deploy_time_s",
  "exec_time_s",
  "wait_time_s",
] as const;

/**
 * The complete set of `activity:list` fields a caller may ever receive — an
 * ALLOWLIST, not a description. `type` is the field that carries the meaning
 * here: a machine enum (`environment.push`, `environment_type.access.delete`)
 * saying WHAT the activity was.
 *
 * `description` is deliberately absent, and is NOT an oversight to be
 * corrected. Its content is personal data — a user-management activity's
 * description reads "<person> removed user <person> from environment type
 * production" — and a field allowlist cannot filter the CONTENT of a free-text
 * field, only its presence. It is not requested (`../commands.ts`), and the
 * projection below drops it even if the CLI prints it anyway.
 */
export interface ActivityListRow {
  readonly id: string;
  readonly created: string;
  readonly type: string;
  readonly state: string;
  readonly result: string;
  readonly progress: string;
  readonly completed: string;
  readonly build_time_s: string;
  readonly deploy_time_s: string;
  readonly exec_time_s: string;
  readonly wait_time_s: string;
}

export function parseActivityList(text: string): readonly ActivityListRow[] {
  const rows = parseTsvRows(text);
  const rawRows = rowsToRecords<ActivityListRow>(rows, {
    subcommand: "activity:list",
    requiredHeaders: ACTIVITY_LIST_REQUIRED_HEADERS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToRecords` keys a
  // record by EVERY header the CLI printed and the narrow `ActivityListRow` is
  // a compile-time claim only, so a spread would serialize whatever extra
  // column came back. That is not hypothetical here: a `Description` column is
  // exactly one dropped `--columns` flag away, and it is the one column whose
  // content must never reach a model's context.
  return rawRows.map((raw) => ({
    id: raw.id,
    created: raw.created,
    type: raw.type,
    state: raw.state,
    result: raw.result,
    progress: raw.progress,
    completed: raw.completed,
    build_time_s: raw.build_time_s,
    deploy_time_s: raw.deploy_time_s,
    exec_time_s: raw.exec_time_s,
    wait_time_s: raw.wait_time_s,
  }));
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
  // `parameters`, `text` and `commands` are dropped because each carries an
  // ARBITRARY payload — whatever the activity happened to be handed, which is
  // exactly what cannot be reasoned about ahead of time.
  //
  // `description` is dropped for a stronger reason, and dropping it is NOT an
  // oversight to be corrected: unlike `activity:list`, where `--columns` means
  // it is never fetched, `activity:get` prints it regardless — and its content
  // is personal data ("<person> removed user <person> from environment type
  // production"). No field allowlist can filter the CONTENT of a free-text
  // field; the only control available is to not pass it on. `type` carries the
  // same meaning as a machine enum and stays.
  return {
    id: raw.id,
    type: raw.type,
    state: raw.state,
    result: raw.result,
    completion_percent: raw.completion_percent,
    created_at: raw.created_at,
    completed_at: raw.completed_at,
  };
}
