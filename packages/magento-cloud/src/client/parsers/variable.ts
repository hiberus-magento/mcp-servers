// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `variable:list` / `variable:get` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2).
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

// `variable:list` has no `is_sensitive` column — that flag exists only on
// `variable:get`. So this parser cannot tell a secret from a feature flag,
// and a live smoke test showed the CLI printing a project variable's
// http-basic credentials in full in the `Value` cell. A name-based heuristic
// would not have caught it either: the credential was nested inside a JSON
// value under an innocuous name.
//
// So the value is dropped BY CONSTRUCTION, the same way
// `parseServiceEndpoints` drops a relationship's username and password
// (design.md, Decision 7): `VariableListRow` is built field by field and has
// no `value` member, so a value cannot reach a caller even by accident. What
// survives is whether a value is set at all, which is what an agent actually
// needs to reason about configuration.
//
// `Value` stays in the required headers: it is part of the contract we
// assert against the CLI's output, and losing that column should still be a
// loud shape error rather than a silently absent `hasValue`.
export const VARIABLE_LIST_REQUIRED_HEADERS = ["name", "level", "value", "enabled"] as const;

export interface VariableListRow {
  readonly name: string;
  readonly level: string;
  readonly enabled: string;
  readonly hasValue: boolean;
}

interface VariableListRawRow {
  readonly name: string;
  readonly level: string;
  readonly value: string;
  readonly enabled: string;
}

export function parseVariableList(text: string): readonly VariableListRow[] {
  const rows = parseTsvRows(text);
  const raw = rowsToRecords<VariableListRawRow>(rows, {
    subcommand: "variable:list",
    requiredHeaders: VARIABLE_LIST_REQUIRED_HEADERS,
  });

  // Field by field, by name — never `{ ...row }`, so neither `value` nor a
  // column this mapper does not know about can reach the result.
  return raw.map((row) => ({
    name: row.name,
    level: row.level,
    enabled: row.enabled,
    hasValue: row.value.length > 0,
  }));
}

export const VARIABLE_GET_REQUIRED_KEYS = ["name", "value"] as const;

export interface VariableGetRecord {
  readonly name: string;
  readonly value: string;
}

// `variable:get` names ONE variable the caller asked for by name, so
// returning its value is the deliberate act the caller requested — unlike
// `variable:list`, which would hand over every secret in the environment for
// free. This parser is not exposed as an MCP tool for that reason.
export function parseVariableGet(text: string): VariableGetRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<VariableGetRecord>(rows, {
    subcommand: "variable:get",
    requiredKeys: VARIABLE_GET_REQUIRED_KEYS,
  });
}
