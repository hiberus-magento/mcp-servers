#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// License allowlist enforcement (release-pipeline spec, "License Allowlist
// Enforcement") and THIRD-PARTY-NOTICES.txt staleness check (release-pipeline
// spec, "Per-Package Third-Party Notices"). Resolves licenses for exactly the
// packages that actually landed in a package's bundle, read from the same
// tsup metafile G3 in `verify-bundle.mjs` already inspects — not the whole
// pnpm dependency tree, which includes build-only tools like `eslint` and
// `turbo` that never ship.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderNotices } from "./notices-lib.mjs";

export const DEFAULT_ALLOWLIST = ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"];

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function normalizeLicense(license) {
  if (typeof license === "string") {
    return license;
  }
  if (Array.isArray(license)) {
    return license.map((entry) => (typeof entry === "string" ? entry : entry.type)).join(" OR ");
  }
  if (license && typeof license === "object" && typeof license.type === "string") {
    return license.type;
  }
  return "UNKNOWN";
}

/**
 * Resolves the package name and on-disk package root for one tsup metafile
 * input path. pnpm nests the actual package under a virtual store segment
 * (`node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/...`), so the
 * package name is whatever follows the LAST `node_modules/` segment, not
 * the first — and the package root is read directly from that literal
 * bundler-reported path rather than via Node's module resolution, which
 * enforces pnpm's strict isolation and fails for a package's own
 * transitive-only dependencies (e.g. `zod-to-json-schema`, a dependency of
 * `@modelcontextprotocol/sdk` that fixture-server never declares itself).
 * @param {string} inputPath
 * @param {string} packageDir
 */
function resolvePackageFromInputPath(inputPath, packageDir) {
  const marker = "node_modules/";
  const idx = inputPath.lastIndexOf(marker);
  if (idx === -1) {
    return undefined;
  }
  const prefix = inputPath.slice(0, idx + marker.length);
  const after = inputPath.slice(idx + marker.length);
  const parts = after.split("/");
  const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  if (!name || name === ".pnpm") {
    return undefined;
  }
  return { name, root: join(packageDir, prefix, name) };
}

/**
 * Extracts real package names from tsup metafile input paths.
 * @param {{inputs?: Record<string, unknown>}} metafile
 * @param {string} [packageDir] only used to resolve relative prefixes consistently; not read from disk here
 */
export function extractBundledPackageNames(metafile, packageDir = ".") {
  const names = new Set();
  for (const inputPath of Object.keys(metafile.inputs ?? {})) {
    const resolved = resolvePackageFromInputPath(inputPath, packageDir);
    if (resolved) {
      names.add(resolved.name);
    }
  }
  return [...names].sort();
}

function findApacheNoticeText(packageJsonPath) {
  const dir = dirname(packageJsonPath);
  const candidates = ["NOTICE", "NOTICE.txt", "NOTICE.md"];
  for (const candidate of candidates) {
    const candidatePath = join(dir, candidate);
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, "utf8");
    }
  }
  return undefined;
}

/**
 * @param {{metafile: {inputs?: Record<string, unknown>}, packageDir: string}} options
 * @returns {Array<{name: string, version: string, license: string, noticeText?: string}>}
 */
export function resolveBundledPackages({ metafile, packageDir }) {
  const roots = new Map();
  for (const inputPath of Object.keys(metafile.inputs ?? {})) {
    const resolved = resolvePackageFromInputPath(inputPath, packageDir);
    if (resolved && !roots.has(resolved.name)) {
      roots.set(resolved.name, resolved.root);
    }
  }
  return [...roots.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, root]) => {
      const pkgJsonPath = join(root, "package.json");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      const license = normalizeLicense(pkg.license ?? pkg.licenses);
      const noticeText = license === "Apache-2.0" ? findApacheNoticeText(pkgJsonPath) : undefined;
      return { name, version: pkg.version ?? "0.0.0", license, ...(noticeText ? { noticeText } : {}) };
    });
}

/**
 * @param {Array<{name: string, version: string, license: string}>} packages
 * @param {readonly string[]} [allowlist]
 */
export function checkLicenseAllowlist(packages, allowlist = DEFAULT_ALLOWLIST) {
  const allowed = new Set(allowlist);
  const violations = packages.filter((pkg) => !allowed.has(pkg.license));
  return { ok: violations.length === 0, violations };
}

function findMetafilePath(distDir) {
  if (!existsSync(distDir)) {
    return undefined;
  }
  const candidate = readdirSync(distDir).find((name) => name.startsWith("metafile") && name.endsWith(".json"));
  return candidate ? join(distDir, candidate) : undefined;
}

function discoverPublishablePackages(packagesRoot) {
  if (!existsSync(packagesRoot)) {
    return [];
  }
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .filter((packageDir) => findMetafilePath(join(packageDir, "dist")) !== undefined);
}

/**
 * Checks one package's bundled licenses and THIRD-PARTY-NOTICES.txt freshness.
 * @param {string} packageDir
 */
export function checkPackage(packageDir) {
  const metafilePath = findMetafilePath(join(packageDir, "dist"));
  if (!metafilePath) {
    return { ok: false, packageDir, errors: [`no dist/metafile*.json found — run "pnpm build" first`] };
  }
  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const packages = resolveBundledPackages({ metafile, packageDir });
  const errors = [];

  const { ok: licensesOk, violations } = checkLicenseAllowlist(packages);
  if (!licensesOk) {
    for (const violation of violations) {
      errors.push(`disallowed license "${violation.license}" for dependency "${violation.name}@${violation.version}"`);
    }
  }

  const noticesPath = join(packageDir, "THIRD-PARTY-NOTICES.txt");
  const expectedNotices = renderNotices(packages);
  if (!existsSync(noticesPath)) {
    errors.push(`THIRD-PARTY-NOTICES.txt is missing — run "node scripts/check-licenses.mjs --write" to generate it`);
  } else {
    const actualNotices = readFileSync(noticesPath, "utf8");
    if (actualNotices !== expectedNotices) {
      errors.push(`THIRD-PARTY-NOTICES.txt is stale — run "node scripts/check-licenses.mjs --write" to regenerate it`);
    }
  }

  return { ok: errors.length === 0, packageDir, packages, errors };
}

/** @param {string} packageDir */
export function writeNoticesFor(packageDir) {
  const metafilePath = findMetafilePath(join(packageDir, "dist"));
  if (!metafilePath) {
    throw new Error(`no dist/metafile*.json found for ${packageDir} — run "pnpm build" first`);
  }
  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const packages = resolveBundledPackages({ metafile, packageDir });
  const text = renderNotices(packages);
  writeFileSync(join(packageDir, "THIRD-PARTY-NOTICES.txt"), text, "utf8");
  return text;
}

async function main() {
  const write = process.argv.includes("--write");
  const packagesRoot = join(REPO_ROOT, "packages");
  const packageDirs = discoverPublishablePackages(packagesRoot);

  if (packageDirs.length === 0) {
    console.error("check-licenses: no built packages found (no dist/metafile*.json) — run \"pnpm build\" first.");
    process.exitCode = 1;
    return;
  }

  if (write) {
    for (const packageDir of packageDirs) {
      writeNoticesFor(packageDir);
      console.error(`check-licenses --write: wrote ${packageDir}/THIRD-PARTY-NOTICES.txt`);
    }
    return;
  }

  let failed = false;
  for (const packageDir of packageDirs) {
    const result = checkPackage(packageDir);
    if (!result.ok) {
      failed = true;
      for (const error of result.errors) {
        console.error(`check-licenses: FAIL — ${packageDir}: ${error}`);
      }
    } else {
      console.error(`check-licenses: PASS — ${packageDir} (${result.packages.length} bundled dependencies)`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
