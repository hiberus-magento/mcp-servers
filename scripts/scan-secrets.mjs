#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Secret scanning over the diff (release-pipeline spec, "Secret Scanning").
// This repository is public — a real credential ever committed here is a
// take-it-out-of-rotation-immediately event, so this scans every ADDED
// line of a unified diff (never the whole tree, to avoid re-flagging
// history) against a small set of credential-shaped patterns and reports
// the exact file and line.
import { execFileSync } from "node:child_process";

export const SECRET_PATTERNS = [
  { rule: "generic-key-assignment", pattern: /(api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_./+-]{16,}["']/i },
  { rule: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/ },
  { rule: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { rule: "bearer-token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { rule: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

function matchesAnyPattern(line) {
  for (const { rule, pattern } of SECRET_PATTERNS) {
    if (pattern.test(line)) {
      return rule;
    }
  }
  return undefined;
}

// This scanner's own RED test deliberately contains a credential-shaped
// literal so the pattern match can be proven against something realistic —
// excluded here the same way mcp-core's eslint-fixtures are excluded from
// the live lint run and proven correct by their own dedicated test instead.
export const SCAN_IGNORE_FILES = ["scripts/scan-secrets.test.mjs"];

/**
 * Scans a unified diff's ADDED lines for credential-shaped strings.
 * @param {string} diffText
 * @param {readonly string[]} [ignoreFiles]
 * @returns {Array<{file: string, line: number, rule: string, snippet: string}>}
 */
// Strip ANSI escape sequences before parsing. `git` colorizes its output even
// into a pipe when a developer has `color.ui = always`, and every line of a
// colorized diff begins with an escape sequence rather than with `+`, `-` or
// `@@`. The parser then matched nothing and the scanner reported PASS on a
// diff that did contain a credential — a security gate silently disabled by
// the reader's git config. `getDiffAgainst` also passes `--no-color`, which
// fixes the cause; this strip defends the parser against any other caller.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function scanDiff(diffText, ignoreFiles = SCAN_IGNORE_FILES) {
  const ignored = new Set(ignoreFiles);
  const violations = [];
  let currentFile;
  let currentLine = 0;

  for (const coloredLine of diffText.split("\n")) {
    const rawLine = coloredLine.replace(ANSI_ESCAPE, "");
    if (rawLine.startsWith("+++ ")) {
      currentFile = rawLine.slice(4).replace(/^b\//, "").replace(/^a\//, "");
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      continue;
    }
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]);
      continue;
    }
    if (rawLine.startsWith("+")) {
      const content = rawLine.slice(1);
      const rule = matchesAnyPattern(content);
      if (rule && currentFile && !ignored.has(currentFile)) {
        violations.push({ file: currentFile, line: currentLine, rule, snippet: content.trim().slice(0, 120) });
      }
      currentLine += 1;
    } else if (!rawLine.startsWith("-") && !rawLine.startsWith("diff ") && !rawLine.startsWith("index ")) {
      currentLine += 1;
    }
  }
  return violations;
}

function getDiffAgainst(baseRef) {
  return execFileSync("git", ["diff", "--no-color", "--unified=0", baseRef], { encoding: "utf8" });
}

async function main() {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : (process.argv[2] ?? "HEAD~1");
  let diffText;
  try {
    diffText = getDiffAgainst(baseRef);
  } catch {
    // No prior commit to diff against (e.g. the repository's first commit) —
    // nothing to scan.
    console.error(`scan-secrets: no diff against "${baseRef}" — nothing to scan.`);
    return;
  }

  const violations = scanDiff(diffText);
  if (violations.length === 0) {
    console.error("scan-secrets: PASS — no credential-shaped strings found in the diff.");
    return;
  }
  for (const violation of violations) {
    console.error(`scan-secrets: FAIL — ${violation.file}:${violation.line} [${violation.rule}] ${violation.snippet}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
