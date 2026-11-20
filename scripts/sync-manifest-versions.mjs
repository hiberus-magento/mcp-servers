// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Copies each package's version from its package.json into servers.json.
// `changeset version` bumps package.json files only; servers.json's
// `version` feeds the README's pinned install snippets (gen-readme.mjs) and
// the packages' manifest tests, so the release workflow runs this right after
// it, and the "Version Packages" pull request carries both.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "servers.json");
const PACKAGES_DIR = join(ROOT, "packages");

/**
 * @param {{ servers: Array<{ package: string, version: string }> }} manifest
 * @param {(packageName: string) => string | undefined} versionOf
 * @returns {{ manifest: object, changed: Array<{ package: string, from: string, to: string }> }}
 */
export function syncManifestVersions(manifest, versionOf) {
  const changed = [];
  const servers = manifest.servers.map((server) => {
    const version = versionOf(server.package);
    if (version === undefined) {
      throw new Error(`servers.json lists ${server.package}, but no package in packages/ has that name.`);
    }
    if (version === server.version) return server;
    changed.push({ package: server.package, from: server.version, to: version });
    return { ...server, version };
  });
  return { manifest: { ...manifest, servers }, changed };
}

function workspaceVersions() {
  const versions = new Map();
  for (const dir of readdirSync(PACKAGES_DIR)) {
    try {
      const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"));
      versions.set(pkg.name, pkg.version);
    } catch {
      // Not a package directory.
    }
  }
  return versions;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const versions = workspaceVersions();
  const { manifest: synced, changed } = syncManifestVersions(manifest, (name) => versions.get(name));
  if (changed.length === 0) {
    console.log("servers.json: versions already match package.json");
    return;
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(synced, null, 2)}\n`);
  for (const change of changed) {
    console.log(`servers.json: ${change.package} ${change.from} -> ${change.to}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
