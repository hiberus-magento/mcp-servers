// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.5: re-running `new-server` on an existing
// package name fails without overwriting (server-manifest spec, "Generator
// rejects a name collision"). Uses temp directories so the test never
// touches the real `packages/` or `servers.json`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNewServer } from "./new-server.mjs";

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
  writeFileSync(serversJsonPath, JSON.stringify({ servers: [] }, null, 2) + "\n", "utf8");
  return { packagesDir, serversJsonPath };
}

describe("runNewServer", () => {
  it("scaffolds a new package and registers it in servers.json", () => {
    const { packagesDir, serversJsonPath } = setup();
    const result = runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A synthetic example domain server.",
      packagesDir,
      serversJsonPath,
    });
    expect(result.ok).toBe(true);
    const manifest = JSON.parse(readFileSync(serversJsonPath, "utf8"));
    expect(manifest.servers).toHaveLength(1);
    expect(manifest.servers[0].id).toBe("example-domain");
    expect(manifest.servers[0].package).toBe("@hiberus-magento/example-domain");
  });

  it("rejects a name collision without overwriting the existing package or manifest", () => {
    const { packagesDir, serversJsonPath } = setup();
    runNewServer({
      name: "example-domain",
      domain: "example",
      description: "A synthetic example domain server.",
      packagesDir,
      serversJsonPath,
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
    });

    expect(second.ok).toBe(false);
    expect(readFileSync(packageJsonPath, "utf8")).toBe(before);
    expect(readFileSync(serversJsonPath, "utf8")).toBe(manifestBefore);
  });
});
