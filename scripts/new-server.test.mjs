// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.5: re-running `new-server` on an existing
// package name fails without overwriting (server-manifest spec, "Generator
// rejects a name collision"). Uses temp directories so the test never
// touches the real `packages/` or `servers.json`.
//
// IMPORTANT: every call below passes an explicit `readmePath` pointing
// inside the temp dir. `runNewServer`'s `readmePath` default is the REAL
// repository `README.md` — a call that supplies `serversJsonPath` but
// omits `readmePath` will silently regenerate the real committed README
// from a throwaway test manifest. This was caught for real during Phase 12
// verification: the committed README ended up with a stray
// `example-domain` entry after a test run.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPackageReadmes } from "./gen-readme.mjs";
import { runNewServer } from "./new-server.mjs";

const README_SKELETON = "# test\n\n<!-- servers:start -->\n<!-- servers:end -->\n";

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

function setup() {
  workDir = mkdtempSync(join(tmpdir(), "new-server-test-"));
  const packagesDir = join(workDir, "packages");
  const serversJsonPath = join(workDir, "servers.json");
  const readmePath = join(workDir, "README.md");
  writeFileSync(serversJsonPath, JSON.stringify({ servers: [] }, null, 2) + "\n", "utf8");
  writeFileSync(readmePath, README_SKELETON, "utf8");
  return { packagesDir, serversJsonPath, readmePath };
}

describe("runNewServer", () => {
  it("scaffolds a new package and registers it in servers.json", () => {
    const { packagesDir, serversJsonPath, readmePath } = setup();
    const result = runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A synthetic example domain server.",
      packagesDir,
      serversJsonPath,
      readmePath,
    });
    expect(result.ok).toBe(true);
    const manifest = JSON.parse(readFileSync(serversJsonPath, "utf8"));
    expect(manifest.servers).toHaveLength(1);
    expect(manifest.servers[0].id).toBe("example-domain");
    expect(manifest.servers[0].package).toBe("@hiberus-magento/example-domain");
  });

  // The scaffold ships a README skeleton with the generator's markers, and
  // `gen-readme --check` now fails on a manifest server whose markers are
  // stale or whose README is absent. If `new-server` did not fill them in,
  // every scaffold would leave CI red on its first commit — the same class of
  // "generator leaves the tree inconsistent" defect the readmePath default
  // above was fixed for.
  it("fills in the scaffolded package's own README from the manifest entry it just registered", () => {
    const { packagesDir, serversJsonPath, readmePath } = setup();
    runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A synthetic example domain server.",
      packagesDir,
      serversJsonPath,
      readmePath,
    });
    const packageReadme = readFileSync(join(packagesDir, "example-domain", "README.md"), "utf8");
    expect(packageReadme).toContain("## Tools");
    expect(packageReadme).toContain("`noop` (read-only)");
    expect(checkPackageReadmes({ packagesDir, manifestPath: serversJsonPath })).toEqual({ stale: [], missing: [] });
  });

  it("rejects a name collision without overwriting the existing package or manifest", () => {
    const { packagesDir, serversJsonPath, readmePath } = setup();
    runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A synthetic example domain server.",
      packagesDir,
      serversJsonPath,
      readmePath,
    });
    const packageJsonPath = join(packagesDir, "example-domain", "package.json");
    const before = readFileSync(packageJsonPath, "utf8");
    const manifestBefore = readFileSync(serversJsonPath, "utf8");

    const second = runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A different description that must never land.",
      packagesDir,
      serversJsonPath,
      readmePath,
    });

    expect(second.ok).toBe(false);
    expect(readFileSync(packageJsonPath, "utf8")).toBe(before);
    expect(readFileSync(serversJsonPath, "utf8")).toBe(manifestBefore);
  });
});
