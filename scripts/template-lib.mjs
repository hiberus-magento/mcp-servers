// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Shared template-rendering used by both `scripts/new-server.mjs` (task
// 11.6) and the fixture-server byte-equality regeneration check (task
// 11.7) — one implementation, so the two can never drift apart the way two
// hand-synced copies of a scaffold would (mirrors the README `--check`
// single-implementation principle in design.md, Decision 6).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_DIR = fileURLToPath(new URL("../templates/server", import.meta.url));

function listFilesRecursive(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, base));
    } else {
      files.push(relative(base, fullPath));
    }
  }
  return files;
}

/** @param {string} [templateDir] */
export function listTemplateFiles(templateDir = TEMPLATE_DIR) {
  return listFilesRecursive(templateDir, templateDir).sort();
}

/** @param {string} content @param {{name: string, domain: string, bin: string}} tokens */
export function substituteTokens(content, { name, domain, bin }) {
  return content.replaceAll("__NAME__", name).replaceAll("__DOMAIN__", domain).replaceAll("__BIN__", bin);
}

/**
 * Renders `templates/server/` into `targetDir`, substituting
 * `__NAME__`/`__DOMAIN__`/`__BIN__` in every file's content.
 * @param {{name: string, domain: string, bin: string, targetDir: string, templateDir?: string}} options
 * @returns {string[]} the relative file paths written, sorted
 */
export function renderTemplate({ name, domain, bin, targetDir, templateDir = TEMPLATE_DIR }) {
  const files = listTemplateFiles(templateDir);
  for (const relativePath of files) {
    const sourcePath = join(templateDir, relativePath);
    const destPath = join(targetDir, relativePath);
    mkdirSync(dirname(destPath), { recursive: true });
    const raw = readFileSync(sourcePath, "utf8");
    writeFileSync(destPath, substituteTokens(raw, { name, domain, bin }), "utf8");
  }
  return files;
}
