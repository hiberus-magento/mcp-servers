// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.3-6.7). Credential stripping is not a formatting
// step — it is the SHAPE of the only exported type (design.md, Decision
// 7). Every assertion here runs against the SAME fixture the fake binary
// itself emits (`environment-relationships.txt`, which carries a synthetic
// username and password), and the strongest proof (6.5) runs on the
// SERIALIZED result, not the in-memory object — proving the credential
// cannot reach an agent even through JSON.stringify.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRawRelationshipsText, parseServiceEndpoints } from "./relationships.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin/fixtures");
const FIXTURE_TEXT = readFileSync(join(FIXTURES_DIR, "environment-relationships.txt"), "utf8");

const FIXTURE_USERNAME = "demo-svc-user";
const FIXTURE_PASSWORD_VALUE = "demo-svc-password-not-real";

describe("parseServiceEndpoints", () => {
  it("returns only host, port, scheme, and service — no username or password field", () => {
    const endpoints = parseServiceEndpoints(FIXTURE_TEXT);

    expect(endpoints).toEqual([{ service: "database", scheme: "mysql", host: "demo-db-host.internal", port: 3306 }]);
    expect(Object.keys(endpoints[0]!).sort()).toEqual(["host", "port", "scheme", "service"]);
  });

  it("STRONGEST PROOF: the SERIALIZED result contains neither the fixture's username nor password value, and no credential-shaped key", () => {
    const endpoints = parseServiceEndpoints(FIXTURE_TEXT);
    const serialized = JSON.stringify(endpoints);

    expect(serialized).not.toContain(FIXTURE_USERNAME);
    expect(serialized).not.toContain(FIXTURE_PASSWORD_VALUE);
    expect(serialized).not.toMatch(/user|pass|secret|token/i);
  });
});

describe("getRawRelationshipsText — the CLI-only opaque escape hatch", () => {
  it("returns the raw, UNSTRIPPED stdout, carrying the fixture's credential — this is the deliberately CLI-only path", () => {
    const rawText = getRawRelationshipsText(FIXTURE_TEXT);

    expect(String(rawText)).toContain(FIXTURE_USERNAME);
    expect(String(rawText)).toContain(FIXTURE_PASSWORD_VALUE);
  });
});

// This repo's own convention (`purity.test.ts:16-23`, batch 1): header
// comments document forbidden patterns BY NAME, which would false-positive
// a naive whole-file scan — strip full-line `//` comments first.
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("source-scan: no spread-from-raw, no leak into client/index.ts's public type", () => {
  it("relationships.ts, comments stripped, contains no `{ ...raw }` (or similarly named) spread", () => {
    const sourcePath = fileURLToPath(new URL("./relationships.ts", import.meta.url));
    const source = stripLineComments(readFileSync(sourcePath, "utf8"));

    expect(/\{\s*\.\.\.\w*[Rr]aw\w*\s*\}/.test(source)).toBe(false);
  });

  it("the regex is proven against a synthetic violating string first", () => {
    expect(/\{\s*\.\.\.\w*[Rr]aw\w*\s*\}/.test("const leaked = { ...raw };")).toBe(true);
    expect(/\{\s*\.\.\.\w*[Rr]aw\w*\s*\}/.test("const leaked = { ...rawRow };")).toBe(true);
  });
});

function listTsFilesRecursively(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Defensive fallback only — `src/tools/` exists as of Phase 8; kept for
    // resilience if this scan is ever pointed at a directory that does not.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFilesRecursively(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("source-scan: no file under src/tools/** references getRawRelationshipsText (tasks.md 6.7, re-run at 8.10)", () => {
  it("finds zero violations, now that src/tools/** genuinely has files (Phase 8 shipped)", () => {
    const toolsDir = fileURLToPath(new URL("../tools/", import.meta.url));
    const files = listTsFilesRecursively(toolsDir);

    // The real assertion this scan exists for: with `src/tools/` no longer
    // empty (unlike Phase 6, when this test's own file predates
    // `tools/magento-cloud-tools.ts`), `getRawRelationshipsText` — the
    // branded, deliberately CLI-only escape hatch (`cli.ts`'s
    // `environment:relationships` command) — must not be referenced from
    // ANY file under the MCP tool surface.
    expect(files.length).toBeGreaterThan(0);

    const violations = files.filter((file) => readFileSync(file, "utf8").includes("getRawRelationshipsText"));
    expect(violations).toEqual([]);
  });

  it("the source-scan itself is proven to fail against a synthetic violating file", () => {
    const violatingText = 'import { getRawRelationshipsText } from "../client/index.js";\n';
    expect(violatingText.includes("getRawRelationshipsText")).toBe(true);
  });
});
