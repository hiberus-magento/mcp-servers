// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `subscription:info` row mapper over `../tsv.ts` (design.md, Decision 4;
// tasks.md 6.1-6.2). Despite the `:info` name, the CLI's own fixture
// (`subscription-info.txt`) is header+row shaped, not field/value —
// `rowsToRecords`, not `rowsToKeyValueRecord`.
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseTsvRows, rowsToRecords } from "../tsv.js";

export const SUBSCRIPTION_INFO_REQUIRED_HEADERS = ["plan", "status"] as const;

export interface SubscriptionInfoRecord {
  readonly plan: string;
  readonly status: string;
}

export function parseSubscriptionInfo(text: string): SubscriptionInfoRecord {
  const rows = parseTsvRows(text);
  const records = rowsToRecords<SubscriptionInfoRecord>(rows, {
    subcommand: "subscription:info",
    requiredHeaders: SUBSCRIPTION_INFO_REQUIRED_HEADERS,
  });
  const [first] = records;
  if (first === undefined) {
    throw new MagentoCloudOutputShapeError({
      subcommand: "subscription:info",
      missingHeader: SUBSCRIPTION_INFO_REQUIRED_HEADERS[0],
      headersSeen: [],
    });
  }
  return first;
}
