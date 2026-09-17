// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `auth:info` row mapper over `../tsv.ts` (design.md, Decision 4; tasks.md
// 6.1-6.2).
import { rowsToKeyValueRecord, parseTsvRows } from "../tsv.js";

export const AUTH_INFO_REQUIRED_KEYS = ["id", "email", "username"] as const;

export interface AuthInfoRecord {
  readonly id: string;
  readonly email: string;
  readonly username: string;
}

export function parseAuthInfo(text: string): AuthInfoRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<AuthInfoRecord>(rows, {
    subcommand: "auth:info",
    requiredKeys: AUTH_INFO_REQUIRED_KEYS,
  });
}
