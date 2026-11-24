// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Copies each package's version from its package.json into servers.json, and into the package's own server.json
// (the MCP registry manifest an MCP host reads from the installed package) when it ships one.
// `changeset version` bumps package.json files only; servers.json's
// `version` feeds the README's pinned install snippets (gen-readme.mjs) and
// the packages' manifest tests, so the release workflow runs this right after
// it, and the version commit it pushes to main carries both.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * @param {{ version: string, packages: Array<{ version?: string }> }} serverJson
 * @param {string} version
 * @returns {{ serverJson: object, changed: boolean }}
 */
export function syncServerJsonVersion(serverJson, version) {
  const changed = serverJson.version !== version || serverJson.packages.some((pack) => pack.version !== version);
  if (!changed) return { serverJson, changed };
  return { serverJson: { ...serverJson, version, packages: serverJson.packages.map((pack) => ({ ...pack, version })) }, changed };
}

/** Each package's server.json, brought to the version in its package.json. */
function syncServerJsonFiles() {
  for (const dir of readdirSync(PACKAGES_DIR)) {
    const path = join(PACKAGES_DIR, dir, "server.json");
    if (!existsSync(path)) continue;
    const { version } = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"));
    const { serverJson, changed } = syncServerJsonVersion(JSON.parse(readFileSync(path, "utf8")), version);
    if (changed) {
      writeFileSync(path, `${JSON.stringify(serverJson, null, 2)}\n`);
      console.log(`packages/${dir}/server.json: -> ${version}`);
    }
  }
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
  syncServerJsonFiles();
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

// pathToFileURL encodes the path the way import.meta.url does, so a checkout
// path with spaces or non-ASCII characters still runs main().
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
