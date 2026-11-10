// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Mirrors `packages/aco/src/client/purity.test.ts`: `client/` must contain no
// console, no `process.exit`, no `process.env`, no prompt library and no ANSI
// escapes — every environment read lives in the adapter layer, so the client
// is testable with injected dependencies alone.
//
// Adds this package's own structural guard: nothing under `src/**` may touch
// TLS verification. The server this one replaces shipped a template that set
// `NODE_TLS_REJECT_UNAUTHORIZED=0`, a process-wide switch that also disabled
// verification for every other connection in the process. There is no
// supported way to turn verification off here, so the names that would do it
// must not appear in shipped code at all.
//
// Each regex is proven against a synthetic violating string FIRST, in memory,
// before it is pointed at the real tree — a gate must be shown to fail, not
// only to pass.
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

// Assembled at runtime, never as a literal, so this file does not contain the
// text its own source scan below would flag.
const TLS_SWITCH_PATTERN = new RegExp([["NODE", "TLS", "REJECT", "UNAUTHORIZED"].join("_"), ["reject", "Unauthorized"].join("")].join("|"), "i");

function listSourceFiles(dir: string, options: { readonly excludeTests: boolean }): string[] {
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

/** Full-line `//` comments document forbidden patterns by name; a naive whole-file scan would false-positive on them. */
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("forbidden-pattern regexes (proven against synthetic violations first)", () => {
  const samples: ReadonlyArray<readonly [string, string]> = [
    ["console.*", 'console.log("nope")'],
    ["process.exit", "process.exit(1)"],
    ["process.env", "const token = process.env.MAGENTO_GRAPHQL_TOKEN"],
    ["prompt-library import", 'import prompts from "prompts"'],
    ["ANSI escape sequence", "\x1b[31mred\x1b[0m"],
  ];

  it.each(FORBIDDEN_PATTERNS)("$name matches a synthetic violating string", ({ name, pattern }) => {
    const sample = samples.find(([sampleName]) => sampleName === name);
    expect(sample, `no synthetic sample for ${name}`).toBeDefined();
    expect(pattern.test(sample?.[1] ?? "")).toBe(true);
  });

  it("the TLS-switch pattern matches both ways of disabling verification", () => {
    const envName = ["NODE", "TLS", "REJECT", "UNAUTHORIZED"].join("_");
    const optionName = ["reject", "Unauthorized"].join("");
    expect(TLS_SWITCH_PATTERN.test(`env: { ${envName}: "0" }`)).toBe(true);
    expect(TLS_SWITCH_PATTERN.test(`new Agent({ ${optionName}: false })`)).toBe(true);
    expect(TLS_SWITCH_PATTERN.test("fetch(url, { headers })")).toBe(false);
  });
});

describe("client/ purity", () => {
  it("contains no console., process.exit, process.env, prompt-library import, or ANSI escapes", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(CLIENT_DIR, { excludeTests: true })) {
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

describe("packages/magento-graphql/src/** structural guard", () => {
  it("never touches TLS verification anywhere under src/**", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(SRC_DIR, { excludeTests: false })) {
      if (TLS_SWITCH_PATTERN.test(stripLineComments(readFileSync(file, "utf8")))) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
