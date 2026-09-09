// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file is
// never imported by any real code — it exists only so the
// `no-restricted-syntax` ban on `RegExp`/`.startsWith(`/`.includes(`/`.test(`
// under `mcp-core/src/exec/**` (eslint.config.js) can be proven to fire,
// closing off the reintroduction of prefix/regex-based allowlist matching
// (design.md, Decision 4, the audited source's own lesson).
export function looksLikeStatusCommand(requested: string): boolean {
  return requested.startsWith("status");
}
