#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Synthetic-identifier audit (tasks.md 13.3, design.md "Real customer data
// leaking into a public repo" risk). This repository is public — no real
// customer/brand name or real-looking business domain may ever appear in it.
//
// Scans every human-authored text file in the repository. It originally
// covered only fixture directories and `*.example.*` files — eight files —
// and every real identifier leak this repository has had landed instead in
// an `openspec/` planning artifact, which that glob list never looked at.
// The audit reported PASS while the identifier sat in the tree.
//
// Three rules, in increasing specificity:
//   1. `unrecognized-domain` — a business-domain-shaped string that is not on
//      the small allowlist of tools, registries and vendor APIs this project
//      itself depends on.
//   2. `company-suffix` — Inc/Corp/LLC/S.L./S.A./GmbH/Ltd, which suggests a
//      real registered business name.
//   3. `known-identifier` — a denylist of identifiers we know must never be
//      published. Stored as HASHES, because a plaintext list of the customer
//      names we must not publish would itself publish them in a public repo,
//      and matched on a separator-insensitive normal form, because checking a
//      single literal spelling is exactly how one slipped through before.
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DENYLIST_PATH = join(REPO_ROOT, "scripts", "banned-identifiers.json");

// Longest identifier we look for, in words. "northwind traders" is 2; three
// covers a longer brand without making the n-gram sweep expensive.
const MAX_IDENTIFIER_WORDS = 3;

/**
 * Collapse an identifier to a single comparable form, so that
 * "Northwind Traders", "northwind-traders" and "northwindtraders" all hash
 * identically. Checking one literal spelling is exactly how a real
 * identifier slipped through this audit before.
 *
 * @param {string} raw
 * @returns {string} sha256 hex digest of the normalized form
 */
export function hashIdentifier(raw) {
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

function loadBannedHashes() {
  if (!existsSync(DENYLIST_PATH)) {
    return new Set();
  }
  const parsed = JSON.parse(readFileSync(DENYLIST_PATH, "utf8"));
  return new Set(parsed.hashes ?? []);
}

// Domains that legitimately appear in this repository's own docs/config —
// none of them are a customer's identity, they are the tools/registries
// this project itself depends on or publishes through.
const SAFE_DOMAINS = new Set([
  "github.com",
  "npmjs.com",
  "registry.npmjs.org",
  "modelcontextprotocol.io",
  "json-schema.org",
  "apache.org",
  "opensource.org",
  "unpkg.com",
  "adobe.com",
  "nodejs.org",
  "adobelogin.com",
  "ims-na1.adobelogin.com",
  "api.commerce.adobe.com",
  "developer.adobe.com",
  "experienceleague.adobe.com",
  // Vendor domains, not customer identities. A PROJECT hostname is
  // `<projectid>.magento.cloud`, so only the bare forms are safe here —
  // anything with a subdomain in front is a project identifier.
  "magento.cloud",
  "api.magento.cloud",
  "auth.magento.cloud",
  "ssh.api.magento.cloud",
  "platform.sh",
  "aem.live",
  "admin.hlx.page",
  "hlx.page",
  // AEM as a Cloud Service hosts are `author-p<program>-e<environment>.
  // adobeaemcloud.com`: the program and environment ids ARE the subdomain,
  // so only the bare vendor domain and the all-zero synthetic hosts
  // (`SYNTHETIC_AEM_AUTHOR*` in synthetic-identifiers.ts) are safe here.
  "adobeaemcloud.com",
  "author-p00000-e00001.adobeaemcloud.com",
  "author-p00000-e00002.adobeaemcloud.com",
  "publish-p00000-e00001.adobeaemcloud.com",
]);

const DOMAIN_PATTERN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(com|net|org|io|co|es|dev|app|cloud)\b/gi;
const COMPANY_SUFFIX_PATTERN = /\b[A-Z][A-Za-z&' -]{1,40}(Inc|Corp|Corporation|LLC|L\.L\.C\.|S\.L\.|S\.A\.|GmbH|Ltd|PLC)\.?\b/g;

/**
 * @param {string} text
 * @param {string} filePath
 * @returns {Array<{file: string, line: number, rule: string, snippet: string}>}
 */
// In source files a property read like an options object's org field is not a
// business domain, and
// flagging those would make this check unusable — an unusable check gets
// switched off. So in code, the DOMAIN rule looks only inside string literals,
// with `${...}` interpolations stripped out, because a template's interpolation
// is code too: a path template interpolating an org slug is property access
// that merely happens to sit inside a literal.
//
// This narrowing applies to the domain rule alone. The company-suffix rule and
// the hashed denylist still read the whole line, comments included — a real
// customer name written in a comment is exactly the leak this audit exists to
// catch, and neither of those rules can be confused by property access.
const CODE_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/i;
const STRING_LITERAL_PATTERN = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g;
const TEMPLATE_INTERPOLATION_PATTERN = /\$\{[^}]*\}/g;

export function scanTextForBannedIdentifiers(text, filePath, options = {}) {
  const bannedHashes = options.bannedHashes ?? loadBannedHashes();
  const isCode = CODE_EXTENSIONS.test(filePath);
  const violations = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    // What the domain rule is allowed to see on this line.
    const domainScope = isCode
      ? (line.match(STRING_LITERAL_PATTERN) ?? []).join(" ").replace(TEMPLATE_INTERPOLATION_PATTERN, " ")
      : line;
    if (bannedHashes.size > 0) {
      // Sweep every run of 1..MAX_IDENTIFIER_WORDS adjacent word tokens.
      // Separators are dropped by the hash, so a match is found whether the
      // identifier was written spaced, hyphenated or concatenated.
      const words = line.match(/[A-Za-z0-9]+/g) ?? [];
      let flagged = false;
      for (let start = 0; start < words.length && !flagged; start += 1) {
        for (let span = 1; span <= MAX_IDENTIFIER_WORDS && start + span <= words.length; span += 1) {
          if (bannedHashes.has(hashIdentifier(words.slice(start, start + span).join("")))) {
            // Deliberately no snippet: this runs in the CI logs of a public
            // repository, so reporting the match would republish the very
            // identifier it exists to keep out. The location is enough.
            violations.push({ file: filePath, line: index + 1, rule: "known-identifier", snippet: "[REDACTED]" });
            flagged = true;
            break;
          }
        }
      }
    }
    for (const match of domainScope.matchAll(DOMAIN_PATTERN)) {
      const domain = match[0].toLowerCase();
      if (!SAFE_DOMAINS.has(domain)) {
        violations.push({ file: filePath, line: index + 1, rule: "unrecognized-domain", snippet: match[0] });
      }
    }
    for (const match of line.matchAll(COMPANY_SUFFIX_PATTERN)) {
      violations.push({ file: filePath, line: index + 1, rule: "company-suffix", snippet: match[0] });
    }
  });
  return violations;
}

// Text formats worth reading. Anything else (images, lockfiles, binaries) is
// either not human-authored or too noisy to scan usefully.
const TEXT_EXTENSIONS = /\.(md|ts|tsx|js|mjs|cjs|json|ya?ml|txt|csv|html|sh)$/i;
// This audit's own test file is excluded for the same reason the eslint
// fixtures are: it contains deliberate violations, and flagging them would
// mean the check can never pass.
const EXCLUDED_PATHS = /node_modules|\/dist\/|\.turbo|\.git\/|pnpm-lock\.yaml|CHANGELOG\.md|audit-synthetic-identifiers\.test\.mjs/;

export function listCandidateFiles() {
  // Originally this scanned only fixture directories and `*.example.*` files
  // — eight files in total. Every real identifier leak this repository has
  // had landed in an `openspec/` planning artifact instead, which that glob
  // list never looked at, so the audit passed while the identifier sat in
  // the tree. Scan every human-authored text file instead.
  const files = new Set();
  for (const match of globSync("**/*", { cwd: REPO_ROOT })) {
    // Filter here rather than through globSync's `exclude` option: that
    // callback does not reliably see the full relative path, so build
    // outputs under packages/*/dist/ survived it.
    const normalized = match.split("\\").join("/");
    if (TEXT_EXTENSIONS.test(normalized) && !EXCLUDED_PATHS.test(`/${normalized}`)) {
      files.add(normalized);
    }
  }
  return [...files].sort();
}

async function main() {
  const files = listCandidateFiles();
  let violationCount = 0;
  for (const relativePath of files) {
    const absolutePath = join(REPO_ROOT, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      continue;
    }
    const text = readFileSync(absolutePath, "utf8");
    const violations = scanTextForBannedIdentifiers(text, relativePath);
    for (const violation of violations) {
      violationCount += 1;
      console.error(`audit-synthetic-identifiers: FAIL — ${violation.file}:${violation.line} [${violation.rule}] ${violation.snippet}`);
    }
  }
  if (violationCount > 0) {
    process.exitCode = 1;
    return;
  }
  console.error(`audit-synthetic-identifiers: PASS — scanned ${files.length} text file(s), no banned identifiers found.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
