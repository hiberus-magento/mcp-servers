// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Linear-time secret redaction (design.md, Decision 6). One pre-compiled
// alternation, a single `String.replace` pass. Every quantifier sits on a
// disjoint character class with a bounded upper limit (`{1,256}`,
// `{1,128}`, `{1,15}`) and none is nested inside another repeated group —
// there is no backtracking path, linear by construction, not by luck.
//
// Covers `key=value` / `key: value` for a CLOSED key set (an explicit
// alternation of known secret-shaped key names, never an open-ended
// `\w+=` guess) and `scheme://user:pass@host` URLs.
//
// Deliberately no `MCP_NO_REDACT` escape hatch: an env var that disables
// redaction is precisely what a compromised environment would set.
const SECRET_KEYS = [
  "token",
  "password",
  "secret",
  "apikey",
  "api_key",
  "access_token",
  "auth_token",
  "authorization",
  "client_secret",
] as const;

const KEY_VALUE_PATTERN = `\\b(?<key>${SECRET_KEYS.join("|")})(?<sep>\\s*[:=]\\s*)(?<value>[^\\s,;]{1,256})`;
const CREDENTIALED_URL_PATTERN =
  "(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]{1,15}):\\/\\/(?<user>[^:\\/\\s@]{1,128}):(?<pass>[^@\\/\\s]{1,128})@";

const REDACT_PATTERN = new RegExp(`${KEY_VALUE_PATTERN}|${CREDENTIALED_URL_PATTERN}`, "gi");

interface RedactGroups {
  readonly key?: string;
  readonly sep?: string;
  readonly value?: string;
  readonly scheme?: string;
  readonly user?: string;
  readonly pass?: string;
}

const MASK = "***";

export function redact(input: string): string {
  return input.replace(REDACT_PATTERN, (...args) => {
    const groups = args[args.length - 1] as RedactGroups;
    if (groups.scheme !== undefined) {
      return `${groups.scheme}://${MASK}:${MASK}@`;
    }
    return `${groups.key}${groups.sep}${MASK}`;
  });
}
