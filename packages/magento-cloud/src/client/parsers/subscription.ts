// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `subscription:info` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2). It IS one of the CLI's key/value commands, like the
// other `:info` subcommands: a `Property`/`Value` header row followed by
// `field<TAB>value` pairs, with nested blocks (`owner_info`,
// `options_custom`, `project_options`) as indented continuation lines. The
// previous header+row reading came from an invented fixture and could never
// have matched real output.
import { parseTsvRows, rowsToKeyValueRecord } from "../tsv.js";

export const SUBSCRIPTION_INFO_REQUIRED_KEYS = ["plan", "status"] as const;

/**
 * The complete set of `subscription:info` fields a caller may ever receive —
 * an ALLOWLIST, not a description. Everything else the CLI prints is dropped
 * by construction in `parseSubscriptionInfo` below.
 *
 * Only `SUBSCRIPTION_INFO_REQUIRED_KEYS` are guaranteed present, so every
 * other field is honestly `string | undefined` rather than `string`.
 */
export interface SubscriptionInfoRecord {
  readonly plan: string;
  readonly status: string;
  readonly id: string | undefined;
  readonly environments: string | undefined;
  readonly storage: string | undefined;
  readonly user_licenses: string | undefined;
  readonly project_region: string | undefined;
  readonly project_title: string | undefined;
}

export function parseSubscriptionInfo(text: string): SubscriptionInfoRecord {
  const rows = parseTsvRows(text);
  const raw = rowsToKeyValueRecord<SubscriptionInfoRecord>(rows, {
    subcommand: "subscription:info",
    requiredKeys: SUBSCRIPTION_INFO_REQUIRED_KEYS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToKeyValueRecord`
  // returns EVERY top-level pair the CLI printed and the narrow `T` is a
  // compile-time claim only, so a spread would put all of it into a model's
  // context the moment the result is serialized.
  //
  // Notable exclusions: `owner` and `owner_info` (a person's account, name and
  // e-mail — a live smoke test confirmed both), `mageId` and `members` (who
  // else is on the subscription), and `project_ui`, a console URI that names
  // the customer's organization. What survives answers "what is this
  // subscription allowed to do", which is the only thing an agent needs.
  return {
    plan: raw.plan,
    status: raw.status,
    id: raw.id,
    environments: raw.environments,
    storage: raw.storage,
    user_licenses: raw.user_licenses,
    project_region: raw.project_region,
    project_title: raw.project_title,
  };
}
