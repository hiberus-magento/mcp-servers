// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 5.1): `client/` MUST NOT call any `console.*` method,
// MUST NOT call `process.exit`, MUST NOT read `process.env`, MUST NOT
// import a prompt library, and MUST NOT emit ANSI escape sequences
// (eds-client spec, "Client Module Purity"). This is expected to already
// pass by construction (every module was written injected-only) — the test
// proves it, rather than introducing compliance.
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

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(`${full}/`));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test-d.ts")) {
      files.push(full);
    }
  }
  return files;
}

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

  it("every client function returns a plain object, never a pre-formatted display string (spot check)", async () => {
    const { createFetchDouble } = await import("../testing/fetch-double.js");
    const { createEdsClient } = await import("./index.js");
    const { fetch } = createFetchDouble({
      "GET /config/acme-demo-org.json": { status: 200, body: {} },
      "GET /config/acme-demo-org/sites.json": { status: 200, body: [] },
    });
    const client = createEdsClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: {
        domain: "eds",
        getToken: async () => ({ kind: "static" as const, value: "k" }),
        invalidate: () => undefined,
        describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
      },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await client.auth.authStatus({ org: "acme-demo-org" });

    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(String);
  });
});
