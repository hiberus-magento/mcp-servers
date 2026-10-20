#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Closes the loop between `servers.json`'s `requires.env` and the
// environment variables a server package's source actually reads.
// `scripts/gen-readme.mjs` publishes `requires.env` into README.md, so a
// manifest that disagrees with the code is a published-contract defect: it
// tells users to set variables the server ignores, and stays silent about
// the ones it hard-fails without.
//
// WHAT THIS SCANNER SEES (and therefore what the check can catch):
//
//   1. `process.env.NAME` and `process.env["NAME"]` — a literal read.
//   2. `process.env[IDENT]` where `IDENT` is a package-local
//      `const IDENT = "NAME"` — the indirection `aco`/`eds` use.
//   3. Every `const <something>_ENV_VAR = "NAME"`. These names are not read
//      through `process.env` in this package at all: they are handed to
//      `mcp-core`'s `resolveCredentialValue({ envVar })`, which does the
//      read on the package's behalf. Without this rule `ACO_TOKEN`,
//      `EDS_TOKEN` and `MAGENTO_CLOUD_CLI_TOKEN` would be invisible here.
//
// WHAT IT DELIBERATELY DOES NOT SEE:
//
//   - Names outside the server's own domain prefix (`PATH`, `HOME`, …).
//     Those are ambient process environment, not part of a server's
//     published configuration contract, and `requires.env` has never
//     declared them. The prefix is derived from the manifest's own `domain`
//     field, never hardcoded here.
//   - Test files (`*.test.ts`, `*.test-d.ts`). A variable a test sets up is
//     not a variable the shipped server reads.
//   - A name assembled at runtime from fragments. Nothing in this
//     repository does that today; if something starts to, this scanner
//     will report it as "declared but unread" rather than silently pass.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PACKAGES_DIR = fileURLToPath(new URL("../packages", import.meta.url));

/** `magento-cloud` -> `MAGENTO_CLOUD_`. Derived from the manifest's own `domain`, so a new server needs no change here. */
export function envPrefixForDomain(domain) {
  return `${domain.toUpperCase().replaceAll("-", "_")}_`;
}

function isScannableSourceFile(name) {
  return name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".test-d.ts");
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (isScannableSourceFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ENV_VAR_CONST_PATTERN = /\bconst\s+([A-Za-z_$][\w$]*_ENV_VAR)\s*(?::[^=]+)?=\s*["']([^"']+)["']/g;
const ANY_STRING_CONST_PATTERN = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*["']([^"']+)["']/g;
const DOT_ACCESS_PATTERN = /\bprocess\.env\.([A-Za-z_$][\w$]*)/g;
const LITERAL_INDEX_PATTERN = /\bprocess\.env\[\s*["']([^"']+)["']\s*\]/g;
const IDENTIFIER_INDEX_PATTERN = /\bprocess\.env\[\s*([A-Za-z_$][\w$]*)\s*\]/g;

/**
 * Every environment-variable NAME the non-test sources under `srcDir` read,
 * by the three rules in this file's header. Unfiltered — the caller applies
 * the domain prefix.
 *
 * @param {string} srcDir
 * @returns {Set<string>}
 */
export function collectSourceEnvNames(srcDir) {
  const files = listSourceFiles(srcDir);
  const sources = files.map((file) => readFileSync(file, "utf8"));

  // Pass 1: resolve the package's string constants, so `process.env[IDENT]`
  // can be followed. Built across the whole package because the constant and
  // its use routinely live in different files (`credential-provider.ts`
  // defines, `cli.ts` reads).
  const constants = new Map();
  const names = new Set();
  for (const source of sources) {
    for (const [, identifier, value] of source.matchAll(ANY_STRING_CONST_PATTERN)) {
      constants.set(identifier, value);
    }
    // Rule 3: an `*_ENV_VAR` constant IS an environment read, wherever the
    // actual `process.env` lookup happens.
    for (const [, , value] of source.matchAll(ENV_VAR_CONST_PATTERN)) {
      names.add(value);
    }
  }

  // Pass 2: the direct reads.
  for (const source of sources) {
    for (const [, name] of source.matchAll(DOT_ACCESS_PATTERN)) {
      names.add(name);
    }
    for (const [, name] of source.matchAll(LITERAL_INDEX_PATTERN)) {
      names.add(name);
    }
    for (const [, identifier] of source.matchAll(IDENTIFIER_INDEX_PATTERN)) {
      const resolved = constants.get(identifier);
      if (resolved !== undefined) {
        names.add(resolved);
      }
    }
  }
  return names;
}

/**
 * The names a manifest entry declares, required and optional alike. A bare
 * string is the pre-`required`-flag shape the schema no longer accepts; it is
 * still read here so a stale manifest produces a name diff that says what is
 * actually wrong, instead of a `TypeError` that says nothing.
 */
export function declaredEnvNames(server) {
  return new Set((server.requires?.env ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name)));
}

/** The names a manifest entry declares as `required: true`. */
export function requiredEnvNames(server) {
  return new Set((server.requires?.env ?? []).filter((entry) => entry.required).map((entry) => entry.name));
}

/**
 * @param {{id: string, domain: string, requires?: {env?: Array<{name: string, required: boolean}>}}} server
 * @param {string} [packagesDir]
 * @returns {{declaredButUnread: string[], readButUndeclared: string[]}}
 */
export function diffServerEnv(server, packagesDir = PACKAGES_DIR) {
  const prefix = envPrefixForDomain(server.domain);
  const declared = declaredEnvNames(server);
  const read = new Set([...collectSourceEnvNames(join(packagesDir, server.id, "src"))].filter((name) => name.startsWith(prefix)));

  const offPrefix = [...declared].filter((name) => !name.startsWith(prefix));
  return {
    declaredButUnread: [...declared].filter((name) => name.startsWith(prefix) && !read.has(name)).sort(),
    readButUndeclared: [...read].filter((name) => !declared.has(name)).sort(),
    // A declared name outside the server's own prefix cannot be checked by
    // this scanner, so it is surfaced rather than quietly treated as fine.
    declaredOutsidePrefix: offPrefix.sort(),
  };
}
