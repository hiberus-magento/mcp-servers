// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// What a free-form query is allowed to hand back. The REST tools return a fixed allowlist of fields; SQL has no
// such list, so this module works from the other side — by what a result must never contain — before anything
// reaches an agent:
//
//   - the VALUE of a column whose name says it is a credential (password, hash, token, secret, key, salt, card
//     data) is replaced, whatever table it came from;
//   - in a configuration table (`path` + `value`), the value of a row whose path says it is a secret or an
//     encrypted setting (`crypt/key`, `.../api_key`, `.../password`) is replaced;
//   - binary data becomes a size, BigInt a string, very long text is cut, and credential-shaped text inside
//     ordinary values goes through mcp-core's `redact`.
//
// NULL stays NULL: absence must not be turned into something that looks like a stored secret.
import { redact } from "@hiberus-magento/mcp-core";

export const REDACTED = "[redacted]";

const MAX_CELL_CHARS = 4000;

const CREDENTIAL_COLUMN = /(pass(word|wd)?|hash|token|secret|api_?key|private_?key|salt|cvv|cvc|card_?(number|no)|iban|credential)/i;
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

export function sanitizeRows(columns: readonly string[], rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const isConfigTable = columns.includes("path") && columns.includes("value");
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    const secretConfigRow = isConfigTable && typeof row["path"] === "string" && SECRET_CONFIG_PATH.test(row["path"]);
    for (const column of columns) {
      const value = row[column];
      if (value === null || value === undefined) {
        out[column] = null;
      } else if (CREDENTIAL_COLUMN.test(column) || (secretConfigRow && column === "value")) {
        out[column] = REDACTED;
      } else {
        out[column] = cell(value);
      }
    }
    return out;
  });
}
