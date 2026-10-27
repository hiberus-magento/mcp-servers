// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Plan and apply output redaction (eds-write-surface design.md, Decision 4:
// "All plan output passes through mcp-core's redact"). `redact` works on
// text (`key=value`, `Authorization: <scheme> <credential>`, credentialed
// URLs), but a site document is structured: in `{"apiKey":"…"}` or a diff
// entry `{ pointer: "/tokens/x", after: "…" }` the secret is identified by
// its KEY, which a text pass never sees. So values are masked by key name
// (and, for diff entries, by pointer segment) and every remaining string still
// goes through `redact`.
import { redact } from "@hiberus-magento/mcp-core";
import type { ConfigChange } from "../confirm/merge-patch.js";

const MASK = "***";

// Closed set, compared case-insensitively after dropping `-`/`_`: the
// secret-bearing names an EDS site document or Admin API response uses.
const SECRET_KEYS: ReadonlySet<string> = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "apikey",
  "apikeys",
  "authorization",
  "clientsecret",
  "accesstoken",
  "authtoken",
]);

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.replaceAll(/[-_]/g, "").toLowerCase());
}

/** Masks secret-keyed values at any depth and runs every other string through `redact`. Never mutates. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(result, key, { value: isSecretKey(key) ? MASK : redactValue(entry), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return value;
}

function decodePointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** A change under a secret-named key (e.g. `/tokens/demo/value`) shows neither side. */
export function redactChange(change: ConfigChange): ConfigChange {
  const secret = change.pointer.split("/").slice(1).map(decodePointerToken).some(isSecretKey);
  const mask = (side: unknown) => (secret ? MASK : redactValue(side));
  return {
    pointer: change.pointer,
    ...("before" in change ? { before: mask(change.before) } : {}),
    ...("after" in change ? { after: mask(change.after) } : {}),
  };
}
