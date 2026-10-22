#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Generates the `<!-- servers:start -->`/`<!-- servers:end -->` section of
// README.md from `servers.json` (server-manifest spec, "Generated README,
// No Hand Edits"). `--check` re-runs this exact code path in memory and
// diffs the result against the committed file — a single implementation,
// so the staleness check cannot drift from the generator (design.md,
// Decision 6).
//
// What the ROOT README generates is deliberately narrow: an index table of
// the servers, and one worked client snippet. It used to generate the full
// per-tool list, environment contract and config snippet for every server —
// 163 of the file's 184 lines — which is now the content of three package
// READMEs. A front page that repeats three documents is a fourth copy of
// them, and the copy nobody opens when they change a tool is the one that
// goes stale. What stays generated here is only what a reader must not find
// wrong: which servers exist, what each is for, and where to go next.
//
// The glossary and the sibling-repository links were string constants in
// this file, spliced into the same region. Nothing in `servers.json` fed
// either, so "generated" bought no drift protection — it only meant the
// prose lived where a writer would never look, and that an edit made in
// README.md was silently reverted on the next run. They are hand-written
// prose in README.md now; `gen-readme.test.mjs` asserts against the
// committed file that they are still there.
//
// It also generates the `<!-- package:start -->`/`<!-- package:end -->`
// section of each publishable package's own README.md — the page npm renders
// from the tarball. Only the part that rots is generated (the tool list, the
// environment contract, the version-pinned client snippet); everything a
// stranger needs that the manifest cannot express — which Adobe product this
// talks to, which binary is the CLI and which is the server, where the
// credential comes from, what the server deliberately will not do — is
// hand-written prose around the markers and is preserved verbatim.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- servers:start -->";
const END_MARKER = "<!-- servers:end -->";
const PACKAGE_START_MARKER = "<!-- package:start -->";
const PACKAGE_END_MARKER = "<!-- package:end -->";

/**
 * The exact phrase a tool carrying `unverified` is marked with, in README.md
 * and in the tool's own shipped description alike. Exported so the drift test
 * that keeps those two in step has one spelling to check rather than its own
 * copy of the wording.
 */
export const UNVERIFIED_MARKER = "Not verified against a live service";

const DEFAULT_README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL("../servers.json", import.meta.url));
const DEFAULT_PACKAGES_DIR = fileURLToPath(new URL("../packages", import.meta.url));

// No `www.`: the synthetic-identifier audit allowlists the bare registrable
// domain, and widening that allowlist to admit a subdomain is the wrong
// trade for a link that redirects anyway.
const NPM_PACKAGE_BASE = "https://npmjs.com/package/";

// Only `required: true` variables belong in the consumer snippet: an MCP
// client that is handed `"ACO_API_KEY": "${ACO_API_KEY}"` for a variable the
// operator has not set will commonly forward the literal `${ACO_API_KEY}`,
// which is worse than omitting the key. The optional ones are listed in
// prose below the snippet instead, where "optional" can actually be said.
//
// `--package <spec> <bin>` rather than the bare `npx -y <spec>`: every server
// here declares TWO binaries (an operator CLI and the MCP server) and neither
// is named after the package's last path segment, which is the only name npx
// guesses. Measured against the real packed tarball, the bare form exits 1
// with "could not determine executable to run" — so the snippet this README
// told people to paste could not start any of these servers. The manifest
// already carries the MCP binary in `bin`; this names it.
function renderConsumerConfigSnippet(server) {
  const env = Object.fromEntries(
    (server.requires?.env ?? []).filter((entry) => entry.required).map((entry) => [entry.name, `\${${entry.name}}`]),
  );
  const snippet = {
    mcpServers: {
      [server.bin]: {
        command: "npx",
        args: ["-y", "--package", `${server.package}@${server.version}`, server.bin],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    },
  };
  return ["```json", JSON.stringify(snippet, null, 2), "```"].join("\n");
}

function renderEnvironmentSection(server) {
  const entries = server.requires?.env ?? [];
  if (entries.length === 0) {
    return [];
  }
  return [
    "",
    "Environment:",
    "",
    ...entries.map((entry) => `- \`${entry.name}\` (${entry.required ? "required" : "optional"}) — ${entry.description}`),
  ];
}

// A reader deciding whether to install this is the person who most needs to
// know a tool has never been run against the real service. The marker is
// rendered from `unverified` rather than written by hand so it cannot drift
// from the manifest, and the same sentence appears in the shipped tool
// description, which is what an agent reads before calling the tool.
function renderToolLine(tool) {
  const unverified = tool.unverified ? ` **${UNVERIFIED_MARKER}** — ${tool.unverified}` : "";
  return `- \`${tool.name}\`${tool.readOnly ? " (read-only)" : ""} — ${tool.description}${unverified}`;
}

/**
 * A `|` in a manifest description would otherwise be read as a column break
 * and shear the row apart silently — the table would still render, just
 * wrongly. No description contains one today; the next one written might.
 */
function escapeTableCell(text) {
  return text.replace(/\|/g, "\\|");
}

// `internal` is never published and `planned` is not built yet, so neither
// has an npm page: linking one would put a 404 on the front page.
function isOnNpm(server) {
  return server.status === "alpha" || server.status === "published";
}

// `docs` is "a relative path or URL" (schema). A path needs `./` to resolve
// from the repository root on GitHub; a URL must be left exactly as written.
function renderDocsLink(docs) {
  return /^https?:\/\//.test(docs) ? docs : `./${docs}`;
}

function renderServerRow(server) {
  const name = `\`${server.package}\``;
  const packageCell = isOnNpm(server) ? `[${name}](${NPM_PACKAGE_BASE}${server.package})` : name;
  const references = [`[README](./packages/${server.id}/README.md)`];
  if (server.docs) {
    references.push(`[setup](${renderDocsLink(server.docs)})`);
  }
  const cells = [
    packageCell,
    escapeTableCell(server.description),
    `\`${server.version}\` · ${server.status}`,
    references.join(" · "),
  ];
  return `| ${cells.join(" | ")} |`;
}

// A table, not a section per server. The per-tool list, the environment
// contract and the per-server snippet all live in the package READMEs now;
// what the front page owes a reader is the shape of the set and a way out
// of it. Generated so that a server added to `servers.json` cannot be
// missing from the front page.
function renderServersSection(manifest) {
  if (manifest.servers.length === 0) {
    return ["## Servers", "", "_No servers are published yet._"].join("\n");
  }
  return [
    "## Servers",
    "",
    "| Package | What it talks to | Version | Reference |",
    "| --- | --- | --- | --- |",
    ...manifest.servers.map(renderServerRow),
  ].join("\n");
}

// One worked example, not one per server: the snippet's shape is identical
// everywhere and only its package, binary and variables differ, all of which
// the table and the package READMEs already name. Rendered by the same
// `renderConsumerConfigSnippet` the package READMEs use, so the `--package
// <spec> <bin>` form that these two-binary packages actually need has one
// implementation and cannot be retyped wrongly here.
function renderQuickstartSection(manifest) {
  const example = manifest.servers.find(isOnNpm);
  if (!example) {
    return undefined;
  }
  return [
    "## Quickstart",
    "",
    `Nothing to install first — each server is a single bundled file with no runtime dependencies, so \`npx\` fetches and runs it on its own. Add one to your MCP client's configuration; here \`${example.package}\`, and every other server in the table takes the same shape with its own package, binary and variables:`,
    "",
    renderConsumerConfigSnippet(example),
    "",
    `Then see [team setup](./docs/team-setup.md) for which configuration file to put that in, and [\`packages/${example.id}/README.md\`](./packages/${example.id}/README.md) for this server's own tools and environment contract.`,
  ].join("\n");
}

/** @param {{servers: unknown[]}} manifest */
export function renderGeneratedSection(manifest) {
  return [renderServersSection(manifest), renderQuickstartSection(manifest)].filter(Boolean).join("\n\n");
}

/**
 * Splices `generated` between `startMarker` and `endMarker`, preserving every
 * byte outside them. Shared by the root README and the per-package READMEs so
 * the two can only ever differ in what they generate, never in how it is
 * spliced in.
 *
 * @param {string} current
 * @param {string} generated
 * @param {{startMarker: string, endMarker: string, label: string}} markers
 */
function spliceBetweenMarkers(current, generated, markers) {
  const startIndex = current.indexOf(markers.startMarker);
  const endIndex = current.indexOf(markers.endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`${markers.label} is missing the ${markers.startMarker} / ${markers.endMarker} markers`);
  }
  const before = current.slice(0, startIndex + markers.startMarker.length);
  const after = current.slice(endIndex);
  return `${before}\n\n${generated}\n\n${after}`;
}

/**
 * @param {string} currentReadme
 * @param {{servers: unknown[]}} manifest
 */
export function renderFullReadme(currentReadme, manifest) {
  return spliceBetweenMarkers(currentReadme, renderGeneratedSection(manifest), {
    startMarker: START_MARKER,
    endMarker: END_MARKER,
    label: "README.md",
  });
}

// The generated half of a package's own README. Deliberately the same
// renderers the root README uses — `renderToolLine`, `renderEnvironmentSection`
// and `renderConsumerConfigSnippet` — so a tool's unverified wording, a
// variable's required/optional status and the pinned install version are one
// implementation with one spelling, not two that have to be kept in step by
// hand. Headings are `##` because a package README's title is its own `#`.
export function renderPackageSection(server) {
  const lines = [
    "## Tools",
    "",
    server.tools.map(renderToolLine).join("\n"),
  ];

  const env = renderEnvironmentSection(server);
  if (env.length > 0) {
    // `renderEnvironmentSection` opens with ["", "Environment:", ""] — the
    // root README's inline label. A package README gives the same entries a
    // heading of their own instead, so drop those three leading elements.
    lines.push("", "## Environment", "", ...env.slice(3));
  }

  lines.push(
    "",
    "## Configure in an MCP client",
    "",
    "Pin the exact version; pass secrets as environment variable references, never literal values:",
    "",
    renderConsumerConfigSnippet(server),
  );
  return lines.join("\n");
}

/**
 * @param {string} currentReadme
 * @param {{id: string}} server
 */
export function renderFullPackageReadme(currentReadme, server) {
  return spliceBetweenMarkers(currentReadme, renderPackageSection(server), {
    startMarker: PACKAGE_START_MARKER,
    endMarker: PACKAGE_END_MARKER,
    label: `packages/${server.id}/README.md`,
  });
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {{readmePath?: string, manifestPath?: string}} [options] */
export function writeReadme(options = {}) {
  const readmePath = options.readmePath ?? DEFAULT_README_PATH;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const current = readFileSync(readmePath, "utf8");
  const manifest = loadJson(manifestPath);
  const next = renderFullReadme(current, manifest);
  writeFileSync(readmePath, next, "utf8");
  return next;
}

/**
 * @param {{readmePath?: string, manifestPath?: string}} [options]
 * @returns {{stale: boolean, actual: string, expected: string}}
 */
export function checkReadme(options = {}) {
  const readmePath = options.readmePath ?? DEFAULT_README_PATH;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const actual = readFileSync(readmePath, "utf8");
  const manifest = loadJson(manifestPath);
  const expected = renderFullReadme(actual, manifest);
  return { stale: actual !== expected, actual, expected };
}

function packageReadmePath(packagesDir, server) {
  return join(packagesDir, server.id, "README.md");
}

/**
 * Regenerates the marked section of every manifest server's own README.md.
 * A server with no README.md is skipped here and REPORTED by
 * `checkPackageReadmes` — writing a whole file from nothing would invent the
 * hand-written prose that is the larger half of the page.
 *
 * @param {{packagesDir?: string, manifestPath?: string}} [options]
 * @returns {string[]} the ids whose README.md was rewritten
 */
export function writePackageReadmes(options = {}) {
  const packagesDir = options.packagesDir ?? DEFAULT_PACKAGES_DIR;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = loadJson(manifestPath);
  const written = [];
  for (const server of manifest.servers) {
    const readmePath = packageReadmePath(packagesDir, server);
    if (!existsSync(readmePath)) {
      continue;
    }
    writeFileSync(readmePath, renderFullPackageReadme(readFileSync(readmePath, "utf8"), server), "utf8");
    written.push(server.id);
  }
  return written;
}

/**
 * @param {{packagesDir?: string, manifestPath?: string}} [options]
 * @returns {{stale: string[], missing: string[]}}
 */
export function checkPackageReadmes(options = {}) {
  const packagesDir = options.packagesDir ?? DEFAULT_PACKAGES_DIR;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = loadJson(manifestPath);
  const stale = [];
  const missing = [];
  for (const server of manifest.servers) {
    const readmePath = packageReadmePath(packagesDir, server);
    if (!existsSync(readmePath)) {
      missing.push(server.id);
      continue;
    }
    const actual = readFileSync(readmePath, "utf8");
    if (actual !== renderFullPackageReadme(actual, server)) {
      stale.push(server.id);
    }
  }
  return { stale, missing };
}

async function main() {
  const check = process.argv.includes("--check");
  if (check) {
    const root = checkReadme();
    const packages = checkPackageReadmes();
    const failed = root.stale || packages.stale.length > 0 || packages.missing.length > 0;
    if (root.stale) {
      console.error("gen-readme --check: README.md is stale relative to servers.json.");
    }
    for (const id of packages.stale) {
      console.error(`gen-readme --check: packages/${id}/README.md is stale relative to servers.json.`);
    }
    for (const id of packages.missing) {
      console.error(
        `gen-readme --check: packages/${id}/README.md does not exist — npm renders a package's page from this file, so a published package without one has a blank page.`,
      );
    }
    if (failed) {
      console.error("Run `node scripts/gen-readme.mjs` to regenerate them.");
      process.exitCode = 1;
      return;
    }
    console.error("gen-readme --check: README.md and every package README are up to date.");
    return;
  }
  writeReadme();
  const written = writePackageReadmes();
  console.error(`gen-readme: README.md regenerated from servers.json, plus ${written.length} package README(s): ${written.join(", ")}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
