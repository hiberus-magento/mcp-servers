// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// What a free-form query is allowed to hand back. The REST tools return a fixed allowlist of fields; SQL has no
// such list, so this module works from the other side — by what a result must never contain — before anything
// reaches an agent:
//
//   - the VALUE of a column whose name says it is a credential (password, hash, token, secret, key, salt, card
//     data) is replaced, whatever table it came from — judged by the name in the result AND by the column's
//     original name the driver reports, so `password_hash AS ph` is still redacted;
//   - in a configuration table (`path` + `value`), the value of a row whose path says it is a secret or an
//     encrypted setting (`crypt/key`, `.../api_key`, `.../password`) is replaced. With the driver's origins, a
//     column that IS `core_config_data.value` (any table prefix, any alias) is replaced when its row's path is a
//     secret, or when no path from that table is in the result to say it is not;
//   - binary data becomes a size, BigInt a string, very long text is cut, and credential-shaped text inside
//     ordinary values goes through mcp-core's `redact`.
//
// NULL stays NULL: absence must not be turned into something that looks like a stored secret.
//
// This is best-effort: an expression (`CONCAT(value)`) has no origin to judge by. The database user's grants are
// the boundary.
import { redact } from "@hiberus-magento/mcp-core";
import { CREDENTIAL_NAME } from "./sql-guard.js";

export const REDACTED = "[redacted]";

/** Where a result column came from, as the driver reports it (mysql2's `orgName` and `orgTable`); empty for an expression. */
export interface ColumnOrigin {
  readonly name: string;
  readonly table: string;
}

const MAX_CELL_CHARS = 4000;

const CONFIG_TABLE = "core_config_data";
const SECRET_CONFIG_PATH = /(crypt|pass(word|wd)?|secret|api_?key|private_?key|token|access_?key|license|salt|credential)/i;

function cell(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Buffer.isBuffer(value)) {
    return `[binary, ${value.length} bytes]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const text = value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}… [truncated, ${value.length} characters]` : value;
    return redact(text);
  }
  if (typeof value === "object") {
    return redact(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
  }
  return value;
}

function isConfigColumn(origin: ColumnOrigin | undefined, name: "path" | "value"): origin is ColumnOrigin {
  return origin !== undefined && origin.name.toLowerCase() === name && origin.table.toLowerCase().endsWith(CONFIG_TABLE);
}

/**
 * `origins[i]` is where `columns[i]` came from; without it (or for an expression) only the visible names are judged,
 * as before.
 */
export function sanitizeRows(columns: readonly string[], rows: readonly Record<string, unknown>[], origins: readonly (ColumnOrigin | undefined)[] = []): Record<string, unknown>[] {
  const isConfigTable = columns.includes("path") && columns.includes("value");
  const credentialColumns = new Set(columns.filter((column, i) => CREDENTIAL_NAME.test(column) || CREDENTIAL_NAME.test(origins[i]?.name ?? "")));
  // Each column that is a configuration value, mapped to the result column holding the path of the same table —
  // undefined when the path is not in the result, which leaves nothing to clear the value by.
  const configValues = new Map<string, string | undefined>();
  columns.forEach((column, i) => {
    const origin = origins[i];
    if (!isConfigColumn(origin, "value")) return;
    const pathIndex = origins.findIndex((candidate) => isConfigColumn(candidate, "path") && candidate.table.toLowerCase() === origin.table.toLowerCase());
    configValues.set(column, pathIndex >= 0 ? columns[pathIndex] : undefined);
  });
  const secretConfigValue = (row: Record<string, unknown>, column: string): boolean => {
    if (!configValues.has(column)) return false;
    const pathColumn = configValues.get(column);
    const path = pathColumn === undefined ? undefined : row[pathColumn];
    return typeof path !== "string" || SECRET_CONFIG_PATH.test(path);
  };
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    const secretConfigRow = isConfigTable && typeof row["path"] === "string" && SECRET_CONFIG_PATH.test(row["path"]);
    for (const column of columns) {
      const value = row[column];
      if (value === null || value === undefined) {
        out[column] = null;
      } else if (credentialColumns.has(column) || (secretConfigRow && column === "value") || secretConfigValue(row, column)) {
        out[column] = REDACTED;
      } else {
        out[column] = cell(value);
      }
    }
    return out;
  });
}
