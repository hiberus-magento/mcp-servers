// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Prepares the GitHub releases for what `changeset publish` just published, the way the changesets action used to:
// one release per new tag, its notes being that version's CHANGELOG section. It runs no command itself (the
// repository allows `execFile` only in mcp-core's exec module): it writes each release's notes to a file and prints
// `<tag>\t<notes file>` per line, and the release workflow pushes the tag and calls `gh release create` for each.
//
//   node scripts/github-releases.mjs <publish log> <notes directory>
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// eslint-disable-next-line no-control-regex -- the publish log is coloured with ANSI escapes
const ANSI = /\u001b\[[0-9;]*m/g;
const NEW_TAG = /New tag:\s+(\S+)@(\d[^\s@]*)\s*$/;

/** The tags `changeset publish` reports creating, in order. */
export function newTags(log) {
  return log
    .replace(ANSI, "")
    .split("\n")
    .map((line) => NEW_TAG.exec(line))
    .filter((match) => match !== null)
    .map(([, name, version]) => ({ tag: `${name}@${version}`, name, version }));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of `## <version>` in a CHANGELOG, up to the next `## ` heading; a plain line when there is none. */
export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## ${escapeRegExp(version)}\\s*$`, "m");
  const start = heading.exec(changelog);
  if (start === null) return `Release ${version}.`;
  const rest = changelog.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
}

/** The directory of the workspace package with this name, under packages/. */
function packageDir(root, name) {
  const packages = join(root, "packages");
  for (const dir of readdirSync(packages)) {
    const manifest = join(packages, dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return join(packages, dir);
  }
  return undefined;
}

function main([logPath, outDir]) {
  if (logPath === undefined || outDir === undefined) {
    process.stderr.write("usage: node scripts/github-releases.mjs <publish log> <notes directory>\n");
    return 2;
  }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  mkdirSync(outDir, { recursive: true });
  newTags(readFileSync(logPath, "utf8")).forEach(({ tag, name, version }, index) => {
    const dir = packageDir(root, name);
    const changelog = dir !== undefined && existsSync(join(dir, "CHANGELOG.md")) ? readFileSync(join(dir, "CHANGELOG.md"), "utf8") : "";
    const notes = join(outDir, `${index}.md`);
    writeFileSync(notes, `${releaseNotes(changelog, version)}\n`);
    process.stdout.write(`${tag}\t${notes}\n`);
  });
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
