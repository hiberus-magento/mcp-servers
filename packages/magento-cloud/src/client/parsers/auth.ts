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
  const raw = rowsToKeyValueRecord<AuthInfoRecord>(rows, {
    subcommand: "auth:info",
    requiredKeys: AUTH_INFO_REQUIRED_KEYS,
  });

  // Field by field, by name — never `{ ...raw }`. `rowsToKeyValueRecord`
  // returns EVERY top-level pair the CLI printed and the narrow `T` is a
  // compile-time claim only, so a spread would put all of it into a model's
  // context the moment the result is serialized. A live smoke test confirmed
  // `auth:info` carries `first_name`, `last_name` and `phone_number_verified`:
  // a real person's name and whether their phone is on file, none of which an
  // agent needs to know which account it is acting as.
  //
  // All three survivors are required keys, so all three are plain `string`.
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
  };
}
