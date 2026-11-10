// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// sha256 of a canonical JSON form (aem-sites-package design.md, D8): object
// keys sorted at every level, so two reads of the same state fingerprint the
// same however the author ordered its properties.
import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "undefined")
    .digest("hex");
}
