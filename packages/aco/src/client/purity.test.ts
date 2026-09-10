// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.13): mirrors `packages/eds/src/client/purity.test.ts`
// for the same forbidden-call scan (eds-client spec's "Client Module
// Purity" carries over to `aco-client`'s own "Client Module Purity"
// requirement), and adds ACO's own structural guard: `X-Auth-Token` (EDS's
// header) MUST appear nowhere under `packages/aco/src/**` (design.md,
// Decision 2 — the type system already excludes it from `AcoHeaderName`;
// this scan covers what the type boundary cannot: a `Headers.set()` call
// downstream of header assembly).
//
// Each scanner's regex is proven against a synthetic violating string
// FIRST, in-memory, before it is ever pointed at the real source tree —
// per this change's own rule that a gate must be shown to fail, not only
// to pass.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "console.*", pattern: /console\s*\./ },
  { name: "process.exit", pattern: /process\s*\.\s*exit\s*\(/ },
  { name: "process.env", pattern: /process\s*\.\s*env/ },
  { name: "prompt-library import", pattern: /from\s+["'](inquirer|prompts|enquirer|@inquirer\/prompts)["']/ },
  // eslint-disable-next-line no-control-regex -- deliberately matching the ANSI escape byte itself.
  { name: "ANSI escape sequence", pattern: /\x1b\[/ },
];

// The forbidden EDS header. Deliberately assembled at runtime (never as a
// single string literal) so this test file itself never contains the
// literal text its own source-scan below would otherwise flag.
const FORBIDDEN_AUTH_HEADER_PATTERN = new RegExp(["X", "-", "Auth", "-", "Token"].join(""), "i");

function listSourceFiles(dir: string, options: { readonly excludeTests: boolean } = { excludeTests: true }): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(`${full}/`, options));
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    if (options.excludeTests && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test-d.ts"))) {
      continue;
    }
    files.push(full);
  }
  return files;
}

/** Strips full-line `//` comments before scanning — this repo's convention
 * documents forbidden patterns BY NAME in header comments (e.g. explaining
 * why a header is excluded), which would otherwise false-positive a naive
 * whole-file scan. */
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("forbidden-pattern regexes (proven against synthetic violations first)", () => {
  it.each(FORBIDDEN_PATTERNS)("$name matches a synthetic violating string", ({ pattern }) => {
    const violatingSamples: Record<string, string> = {
      "console.*": 'console.log("nope")',
      "process.exit": "process.exit(1)",
      "process.env": "const token = process.env.ACO_TOKEN",
      "prompt-library import": 'import prompts from "prompts"',
      "ANSI escape sequence": "\x1b[31mred\x1b[0m",
    };
    const sample = Object.entries(violatingSamples).find(([, value]) => pattern.test(value));
    expect(sample, `no synthetic sample was found to trip the "${pattern.source}" pattern`).toBeDefined();
  });

  it("the forbidden-header pattern matches a synthetic forbidden-header usage", () => {
    const forbiddenHeaderName = ["X", "-", "Auth", "-", "Token"].join("");
    expect(FORBIDDEN_AUTH_HEADER_PATTERN.test(`headers.set("${forbiddenHeaderName}", token)`)).toBe(true);
  });

  it("the forbidden-header pattern does NOT match ACO's own AC-* headers", () => {
    expect(FORBIDDEN_AUTH_HEADER_PATTERN.test('headers.set("AC-View-ID", viewId)')).toBe(false);
    expect(FORBIDDEN_AUTH_HEADER_PATTERN.test('headers.set("AC-Catalog-View-Access-Token", token)')).toBe(false);
  });
});

describe("client/ purity", () => {
  it("contains no console., process.exit, process.env, prompt-library import, or ANSI escapes", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(CLIENT_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`${file}: ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("packages/aco/src/** structural guard", () => {
  it("never sends EDS's forbidden auth header anywhere under packages/aco/src/**", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(SRC_DIR, { excludeTests: false })) {
      const text = stripLineComments(readFileSync(file, "utf8"));
      if (FORBIDDEN_AUTH_HEADER_PATTERN.test(text)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
