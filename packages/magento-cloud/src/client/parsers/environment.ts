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

/**
 * The complete set of `environment:info` fields a caller may ever receive — an
 * ALLOWLIST, not a description. Everything else the CLI prints is dropped by
 * construction in `parseEnvironmentInfo` below.
 *
 * Only `ENVIRONMENT_INFO_REQUIRED_KEYS` are guaranteed present, so every other
 * field is honestly `string | undefined` rather than `string`.
 */
export interface EnvironmentInfoRecord {
  readonly id: string;
  readonly status: string;
  readonly type: string;
  readonly name: string | undefined;
  readonly machine_name: string | undefined;
  readonly title: string | undefined;
  readonly parent: string | undefined;
  readonly created_at: string | undefined;
  readonly updated_at: string | undefined;
  readonly default_domain: string | undefined;
  readonly edge_hostname: string | undefined;
  readonly has_domains: string | undefined;
  readonly is_pr: string | undefined;
  readonly has_remote: string | undefined;
  readonly deployment_target: string | undefined;
}

export function parseEnvironmentInfo(text: string): EnvironmentInfoRecord {
  const rows = parseTsvRows(text);
  const raw = rowsToKeyValueRecord<EnvironmentInfoRecord>(rows, {
    subcommand: "environment:info",
    requiredKeys: ENVIRONMENT_INFO_REQUIRED_KEYS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToKeyValueRecord`
  // returns EVERY top-level pair the CLI printed and the narrow `T` is a
  // compile-time claim only, so a spread would put all of it into a model's
  // context the moment the result is serialized.
  //
  // `http_access` is the exclusion worth naming: real output nests a
  // `basic_auth` block under it, so the one field most likely to carry a
  // credential is also the one a spread would have carried furthest. The
  // remaining drops (`enable_smtp`, `restrict_robots`,
  // `clone_parent_on_create`, `max_instance_count`) are simply not
  // allowlisted — an undeclared key does not reach a caller, whatever it is.
  return {
    id: raw.id,
    status: raw.status,
    type: raw.type,
    name: raw.name,
    machine_name: raw.machine_name,
    title: raw.title,
    parent: raw.parent,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    default_domain: raw.default_domain,
    edge_hostname: raw.edge_hostname,
    has_domains: raw.has_domains,
    is_pr: raw.is_pr,
    has_remote: raw.has_remote,
    deployment_target: raw.deployment_target,
  };
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
