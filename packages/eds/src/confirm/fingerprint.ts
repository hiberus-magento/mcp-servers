// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Stale-plan detection (eds-write-surface design.md, Decision 3): the plan
// records the SHA-256 of the canonical JSON of the document the user
// reviewed; `eds_apply` re-reads it and compares before writing.
import { createHash } from "node:crypto";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON with object keys sorted by UTF-16 code unit at every depth and no
 * whitespace, so the same document always encodes to the same string
 * whatever order the server returned its keys in. Array order is kept.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (isPlainObject(value)) {
    const members = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Lowercase hex SHA-256 of {@link canonicalJson}. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
