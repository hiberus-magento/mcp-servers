// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `project:list` / `project:info` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2). Each declares its OWN required-columns
// constant, so a drift affecting one subcommand's shape never masks a
// drift in another's.
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

// The header row `project:list` prints for the EXPLICIT column set
// `../commands.ts` asks for (`id,title,region,status,created_at`) — `ID Title
// Region Status Created` — run through `normalizeHeaderName`. Note the last
// one: asking for `created_at` yields a header cell reading `Created`, so the
// record key is `created`, not `created_at` (pinned in `tsv.test.ts`).
export const PROJECT_LIST_REQUIRED_HEADERS = ["id", "title", "region", "status", "created"] as const;

/**
 * The complete set of `project:list` fields a caller may ever receive — an
 * ALLOWLIST, not a description.
 *
 * `organization_id`, `organization_label`, `organization_name` and
 * `organization_type` are deliberately absent, and are NOT an oversight to be
 * corrected: each names the customer's organization. They are not requested
 * (`../commands.ts`), and the projection below drops them even if the CLI
 * prints them anyway.
 */
export interface ProjectListRow {
  readonly id: string;
  readonly title: string;
  readonly region: string;
  readonly status: string;
  readonly created: string;
}

export function parseProjectList(text: string): readonly ProjectListRow[] {
  const rows = parseTsvRows(text);
  const rawRows = rowsToRecords<ProjectListRow>(rows, {
    subcommand: "project:list",
    requiredHeaders: PROJECT_LIST_REQUIRED_HEADERS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToRecords` keys a
  // record by EVERY header the CLI printed and the narrow `ProjectListRow` is
  // a compile-time claim only, so a spread would serialize whatever extra
  // column came back. This check must not depend on the request being right:
  // it holds even if `--columns` is ever dropped.
  return rawRows.map((raw) => ({
    id: raw.id,
    title: raw.title,
    region: raw.region,
    status: raw.status,
    created: raw.created,
  }));
}

export const PROJECT_INFO_REQUIRED_KEYS = ["id", "title", "region"] as const;

/**
 * The complete set of `project:info` fields a caller may ever receive — an
 * ALLOWLIST, not a description. Everything else the CLI prints is dropped by
 * construction in `parseProjectInfo` below.
 *
 * Only `PROJECT_INFO_REQUIRED_KEYS` are guaranteed present, so every other
 * field is honestly `string | undefined` rather than `string`: the CLI may
 * simply not print it. `?:` would be the wrong tool — under
 * `exactOptionalPropertyTypes` an optional property cannot be assigned a
 * possibly-`undefined` value without extra ceremony at every assignment.
 */
export interface ProjectInfoRecord {
  readonly id: string;
  readonly title: string;
  readonly region: string;
  readonly status: string | undefined;
  readonly created_at: string | undefined;
  readonly updated_at: string | undefined;
  readonly default_branch: string | undefined;
  readonly timezone: string | undefined;
  readonly default_domain: string | undefined;
}

export function parseProjectInfo(text: string): ProjectInfoRecord {
  const rows = parseTsvRows(text);
  const raw = rowsToKeyValueRecord<ProjectInfoRecord>(rows, {
    subcommand: "project:info",
    requiredKeys: PROJECT_INFO_REQUIRED_KEYS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToKeyValueRecord`
  // returns EVERY top-level pair the CLI printed and the narrow `T` is a
  // compile-time claim only, so a spread would hand the whole record to a
  // caller and `JSON.stringify` would put all of it into a model's context.
  //
  // Notable exclusions, all confirmed present in real output: `client_ssh_key`
  // (SSH public key material), `subscription_management_uri` (a billing URI),
  // `owner`, `organization` and `subscription` (people and billing identity),
  // and `description`, `namespace`, `repository` and `url`, which identify the
  // customer without telling an agent anything it needs.
  return {
    id: raw.id,
    title: raw.title,
    region: raw.region,
    status: raw.status,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    default_branch: raw.default_branch,
    timezone: raw.timezone,
    default_domain: raw.default_domain,
  };
}
