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

export interface SubscriptionInfoRecord {
  readonly plan: string;
  readonly status: string;
}

export function parseSubscriptionInfo(text: string): SubscriptionInfoRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<SubscriptionInfoRecord>(rows, {
    subcommand: "subscription:info",
    requiredKeys: SUBSCRIPTION_INFO_REQUIRED_KEYS,
  });
}
