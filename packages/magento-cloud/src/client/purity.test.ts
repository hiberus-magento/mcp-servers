// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 9.9): mirrors `packages/aco/src/client/purity.test.ts`
// (read-only precedent). `client/` is pure — magento-cloud-client spec,
// "Client Module Purity": no `console.`/`process.exit`/`process.env`/
// prompt-library import/ANSI escape anywhere under `client/`. Each regex is
// proven against a synthetic violating string FIRST, per this repository's
// own convention, before it is ever pointed at the real source tree.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_DIR = fileURLToPath(new URL(".", import.meta.url));

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "console.*", pattern: /console\s*\./ },
  { name: "process.exit", pattern: /process\s*\.\s*exit\s*\(/ },
  { name: "process.env", pattern: /process\s*\.\s*env/ },
  { name: "prompt-library import", pattern: /from\s+["'](inquirer|prompts|enquirer|@inquirer\/prompts)["']/ },
  // eslint-disable-next-line no-control-regex -- deliberately matching the ANSI escape byte itself.
  { name: "ANSI escape sequence", pattern: /\x1b\[/ },
];

/**
 * Strips full-line `//` comments before scanning (mirrors
 * `packages/aco/src/client/purity.test.ts`'s structural-guard helper).
 * This package's own `locate-binary.ts`/`child-env.ts` document, IN
 * COMMENTS, exactly why `process.env` is NEVER read directly — a
 * comment-blind scan flagged those two documentation lines as violations on
 * the first real run of this test (a genuine false positive, not a staged
 * one), which is the honest reason this helper exists here even though
 * aco's own client/ purity scan never needed it.
 */
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(`${full}/`));
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test-d.ts")) {
      continue;
    }
    files.push(full);
  }
  return files;
}

describe("forbidden-pattern regexes (proven against synthetic violations first)", () => {
  it.each(FORBIDDEN_PATTERNS)("$name matches a synthetic violating string", ({ pattern }) => {
    const violatingSamples: Record<string, string> = {
      "console.*": 'console.log("nope")',
      "process.exit": "process.exit(1)",
      "process.env": "const token = process.env.MAGENTO_CLOUD_CLI_TOKEN",
      "prompt-library import": 'import prompts from "prompts"',
      "ANSI escape sequence": "\x1b[31mred\x1b[0m",
    };
    const sample = Object.entries(violatingSamples).find(([, value]) => pattern.test(value));
    expect(sample, `no synthetic sample was found to trip the "${pattern.source}" pattern`).toBeDefined();
  });
});

describe("client/ purity", () => {
  it("contains no console., process.exit, process.env, prompt-library import, or ANSI escapes", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(CLIENT_DIR)) {
      const text = stripLineComments(readFileSync(file, "utf8"));
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`${file}: ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
