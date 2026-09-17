#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The cold-start re-measure trigger's evidence step (design.md, Decision 5;
// tasks.md 7.1). Prints the byte size of two built `dist/mcp.js` bundles and
// the ratio between them — read-only, no production code touched. The
// caller decides what to do with the ratio (tasks.md 7.2/7.3): a package
// whose bundle differs from the reference by more than 20% is the signal
// that `COLD_START_BUDGET_MS` (a single constant shared by every package in
// `describeConformance`) may no longer fit it and must be re-measured
// rather than silently reused.
import { statSync } from "node:fs";

/**
 * @param {string} path
 * @returns {number}
 */
export function bundleByteSize(path) {
  return statSync(path).size;
}

/**
 * Ratio of `subjectBytes` relative to `referenceBytes`, as a signed
 * fraction (e.g. 0.25 means the subject is 25% larger than the reference,
 * -0.10 means 10% smaller). Never rounded here — the caller decides the
 * threshold and the rounding.
 * @param {number} subjectBytes
 * @param {number} referenceBytes
 * @returns {number}
 */
export function sizeRatio(subjectBytes, referenceBytes) {
  if (referenceBytes === 0) {
    throw new Error("sizeRatio: referenceBytes is 0 — cannot compute a ratio against an empty reference bundle.");
  }
  return (subjectBytes - referenceBytes) / referenceBytes;
}

function formatPercent(ratio) {
  const sign = ratio >= 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(1)}%`;
}

async function main() {
  const [subjectPath, referencePath] = process.argv.slice(2);
  if (!subjectPath || !referencePath) {
    console.error("Usage: node scripts/compare-bundle-size.mjs <subjectBundlePath> <referenceBundlePath>");
    console.error("Example: node scripts/compare-bundle-size.mjs packages/aco/dist/mcp.js packages/eds/dist/mcp.js");
    process.exitCode = 1;
    return;
  }

  const subjectBytes = bundleByteSize(subjectPath);
  const referenceBytes = bundleByteSize(referencePath);
  const ratio = sizeRatio(subjectBytes, referenceBytes);

  console.log(
    JSON.stringify(
      {
        subjectPath,
        subjectBytes,
        referencePath,
        referenceBytes,
        ratio,
      },
      null,
      2,
    ),
  );
  console.error(
    `compare-bundle-size: ${subjectPath} = ${subjectBytes} bytes; ${referencePath} = ${referenceBytes} bytes; ratio = ${formatPercent(ratio)}` +
      ` — ${Math.abs(ratio) > 0.2 ? "TRIGGER: |ratio| > 20%, a re-measure is required (tasks.md 7.3)" : "no trigger: |ratio| <= 20% (tasks.md 7.2)"}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
