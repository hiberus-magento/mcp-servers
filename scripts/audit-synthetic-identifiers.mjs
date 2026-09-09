#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Synthetic-identifier audit (tasks.md 13.3, design.md "Real customer data
// leaking into a public repo" risk). This repository is public — no real
// customer/brand name or real-looking business domain may ever appear in a
// fixture or example. Scans `packages/**/fixtures/**`,
// `packages/**/eslint-fixtures/**`, and `**/*.example.*` for two generic,
// name-agnostic red flags: a business-domain-shaped string not on the
// small safe-domains allowlist, and a company-suffix pattern (Inc/Corp/LLC/
// S.L./S.A./GmbH/Ltd) that suggests a real registered business name.
import { globSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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
]);

const DOMAIN_PATTERN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(com|net|org|io|co|es|dev|app)\b/gi;
const COMPANY_SUFFIX_PATTERN = /\b[A-Z][A-Za-z&' -]{1,40}(Inc|Corp|Corporation|LLC|L\.L\.C\.|S\.L\.|S\.A\.|GmbH|Ltd|PLC)\.?\b/g;

/**
 * @param {string} text
 * @param {string} filePath
 * @returns {Array<{file: string, line: number, rule: string, snippet: string}>}
 */
export function scanTextForBannedIdentifiers(text, filePath) {
  const violations = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(DOMAIN_PATTERN)) {
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

function listCandidateFiles() {
  // Plain-Node glob (available on Node 22 via fs.globSync) restricted to
  // exactly the paths the task names: fixture directories and any
  // `*.example.*` file, repo-wide.
  const patterns = ["packages/**/fixtures/**/*", "packages/**/eslint-fixtures/**/*", "**/*.example.*"];
  const exclude = (matched) => /node_modules|\/dist\/|\.turbo/.test(matched);
  const files = new Set();
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd: REPO_ROOT, exclude })) {
      files.add(match);
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
  console.error(`audit-synthetic-identifiers: PASS — scanned ${files.length} fixture/example file(s), no banned identifiers found.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
