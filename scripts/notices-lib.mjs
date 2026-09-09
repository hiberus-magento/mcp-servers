// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Renders `THIRD-PARTY-NOTICES.txt` content from a resolved bundled-package
// list (release-pipeline spec, "Per-Package Third-Party Notices"). Used by
// both `check-licenses.mjs --write` (generation) and its default mode
// (staleness check) — one implementation, so the two cannot drift, mirroring
// the `gen-readme.mjs` `--check` pattern.
const HEADER = "Third-Party Notices\n====================\n";
const INTRO =
  "This package is distributed as a single bundled file with no runtime\n" +
  "dependencies of its own. It statically bundles the following third-party\n" +
  "packages:\n";

/**
 * @param {Array<{name: string, version: string, license: string, noticeText?: string}>} packages
 * @returns {string}
 */
export function renderNotices(packages) {
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [HEADER, INTRO];
  for (const pkg of sorted) {
    lines.push(`- ${pkg.name}@${pkg.version} — ${pkg.license}`);
  }

  const withNotice = sorted.filter((pkg) => pkg.noticeText);
  if (withNotice.length > 0) {
    lines.push("");
    lines.push("=".repeat(70));
    lines.push("NOTICE");
    lines.push("=".repeat(70));
    lines.push("");
    lines.push(
      "The following NOTICE text is reproduced verbatim as required by the\n" +
        "Apache License, Version 2.0, for each bundled Apache-2.0 dependency\n" +
        "that ships its own NOTICE file:",
    );
    for (const pkg of withNotice) {
      lines.push("");
      lines.push(`--- ${pkg.name}@${pkg.version} ---`);
      lines.push(pkg.noticeText.trimEnd());
    }
  }

  return `${lines.join("\n")}\n`;
}
