// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `variable:list` / `variable:get` row mappers over `../tsv.ts` (design.md,
// Decision 4; tasks.md 6.1-6.2).
import { parseTsvRows, rowsToKeyValueRecord, rowsToRecords } from "../tsv.js";

export const VARIABLE_LIST_REQUIRED_HEADERS = ["name", "value", "is_sensitive"] as const;

export interface VariableListRow {
  readonly name: string;
  readonly value: string;
  readonly is_sensitive: string;
}

export function parseVariableList(text: string): readonly VariableListRow[] {
  const rows = parseTsvRows(text);
  return rowsToRecords<VariableListRow>(rows, {
    subcommand: "variable:list",
    requiredHeaders: VARIABLE_LIST_REQUIRED_HEADERS,
  });
}

export const VARIABLE_GET_REQUIRED_KEYS = ["name", "value"] as const;

export interface VariableGetRecord {
  readonly name: string;
  readonly value: string;
}

export function parseVariableGet(text: string): VariableGetRecord {
  const rows = parseTsvRows(text);
  return rowsToKeyValueRecord<VariableGetRecord>(rows, {
    subcommand: "variable:get",
    requiredKeys: VARIABLE_GET_REQUIRED_KEYS,
  });
}
