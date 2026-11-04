// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Protected sites (eds-write-surface design.md, Decision 6). `mcp.ts` reads
// `EDS_PROTECTED_SITES` and passes the value in; this module never touches
// the environment. `*` is the only special character, matching is anchored
// and case-sensitive, and no regular expression is built from the value —
// so `.`, `+` and friends are literal and a pattern cannot backtrack
// catastrophically.

/** Splits a comma-separated pattern list; blank entries are dropped. */
export function parseProtectedSites(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

// Classic wildcard match: on a mismatch, retry from the most recent `*`
// with it absorbing one more character. Only the last `*` is ever revisited,
// so the cost is bounded by pattern length × site length.
function matchesPattern(site: string, pattern: string): boolean {
  let s = 0;
  let p = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (s < site.length) {
    if (p < pattern.length && pattern[p] === "*") {
      starAt = p;
      resumeAt = s;
      p += 1;
    } else if (p < pattern.length && pattern[p] === site[s]) {
      s += 1;
      p += 1;
    } else if (starAt !== -1) {
      p = starAt + 1;
      resumeAt += 1;
      s = resumeAt;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

/** True when `site` matches any of `patterns` (see the module comment). */
export function matchesSitePattern(site: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(site, pattern));
}
