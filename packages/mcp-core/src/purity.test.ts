// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Source-scan proof (design.md, Decision 1, Layer 3; tasks.md 0.8-0.9)
// mirroring `packages/aco/src/client/purity.test.ts`'s helper (read-only
// precedent): `run-allowlisted.ts`, with full-line `//` comments stripped,
// contains no `process.env` token. Header comments in this repo's
// convention document forbidden patterns BY NAME (e.g. this very file), so
// a naive whole-file scan would false-positive on the comment above the
// spawn call explaining why `process.env` must never appear there — hence
// the strip step, exactly as `purity.test.ts` does for the same reason.
//
// The regex is proven against a synthetic violating string FIRST, in
// memory, before it is ever pointed at real source — per this change's own
// rule that a guard must be shown to fail, not only to pass.
//
// Deliberately lives at `src/purity.test.ts`, NOT under `src/exec/`: that
// glob's own `no-restricted-syntax` array (`eslint.config.js:200-227`) bans
// regex literals and `.test()` in PRODUCTION allowlist-matching code
// (design.md, Decision 4) and applies file-wide, with no test-file carve
// out. This scanner's regex/`.test()` usage is unrelated to that hazard —
// it scans source TEXT, not command tokens — but the safest way to avoid
// even the appearance of special-casing a security boundary is to keep this
// file out of the banned glob entirely.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUN_ALLOWLISTED_PATH = fileURLToPath(new URL("./exec/run-allowlisted.ts", import.meta.url));

const PROCESS_ENV_PATTERN = /process\s*\.\s*env/;

function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("process.env source scan (proven against a synthetic violation first)", () => {
  it("the pattern matches a synthetic violating string", () => {
    expect(PROCESS_ENV_PATTERN.test("const stolen = process.env")).toBe(true);
    expect(PROCESS_ENV_PATTERN.test("const stolen = { ...process.env }")).toBe(true);
  });

  it("the pattern does NOT match unrelated env-shaped identifiers", () => {
    expect(PROCESS_ENV_PATTERN.test("const options = { env: spec.env }")).toBe(false);
  });

  it("run-allowlisted.ts, comments stripped, contains no process.env token", () => {
    const raw = readFileSync(RUN_ALLOWLISTED_PATH, "utf8");
    const stripped = stripLineComments(raw);

    expect(PROCESS_ENV_PATTERN.test(stripped)).toBe(false);
  });
});
