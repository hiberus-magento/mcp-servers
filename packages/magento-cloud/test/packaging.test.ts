// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 9.7). `scripts/verify-bundle.mjs` (read-only —
// unmodified in this batch) already proves G1-G6: single bundle per
// declared bin, size, forbidden deps, tarball `dependencies: {}`, shebang,
// LICENSE (`mcp.conformance.test.ts`'s packaging-gate step). It does NOT
// assert the one thing specific to this package: the checked-in EXECUTABLE
// fake binary (`test/fake-bin/magento-cloud`, the first checked-in
// executable script in this repository, design.md's Threat Matrix
// "Documentation-like paths" row) must never reach the published tarball.
// `package.json`'s `files: ["dist", "LICENSE", "THIRD-PARTY-NOTICES.txt"]`
// already excludes `test/` by construction; this test proves that
// exclusion holds against the REAL, packed tarball, not merely against the
// `files` field's intent.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

function listTarballEntries(): readonly string[] {
  const workDir = mkdtempSync(join(tmpdir(), "magento-cloud-packaging-"));
  try {
    const output = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
    });
    const [result] = JSON.parse(output) as [{ readonly files: readonly { readonly path: string }[] }];
    return result.files.map((entry) => entry.path);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

describe("packaging: the checked-in fake binary must never publish", () => {
  let entries: readonly string[];

  beforeEach(() => {
    entries = listTarballEntries();
  });

  it("the real published tarball contains no test/ entry", () => {
    const testEntries = entries.filter((entry) => entry === "test" || entry.startsWith("test/"));
    expect(testEntries).toEqual([]);
  });

  it("is proven to fail first: a synthetic entries list WITH a test/ path is caught by the same filter", () => {
    const syntheticEntries = ["package.json", "dist/mcp.js", "test/fake-bin/magento-cloud"];
    const testEntries = syntheticEntries.filter((entry) => entry === "test" || entry.startsWith("test/"));
    expect(testEntries).toEqual(["test/fake-bin/magento-cloud"]);
  });

  it("does include the two declared bundles, so this is a real published tarball, not an empty one", () => {
    expect(entries).toContain("dist/cli.js");
    expect(entries).toContain("dist/mcp.js");
  });
});
