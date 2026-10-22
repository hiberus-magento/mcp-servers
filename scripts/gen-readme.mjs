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

const GLOSSARY = [
  "## Glossary",
  "",
  "These three acronyms are adjacent, are **not** the same thing, and Adobe has renamed them before — do not treat them as interchangeable.",
  "",
  "- **EDS** — Edge Delivery Services: the publishing platform (preview/publish, indexing, code sync).",
  "- **ACS** — Adobe Commerce Storefront: a commerce storefront built on EDS (drop-ins, components).",
  "- **ACO** — Adobe Commerce Optimizer.",
].join("\n");

const RELATED_REPOSITORIES = [
  "## Related Repositories",
  "",
  "- [`hiberus-magento/ai-tools`](https://github.com/hiberus-magento/ai-tools) — skills and agents. Knowledge that is edited daily; not published as a package.",
  "- [`hiberus-magento/hiberus-dockergento`](https://github.com/hiberus-magento/hiberus-dockergento) — the development environment that installs and wires this repository and `ai-tools` together.",
].join("\n");

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

function renderServerEntry(server) {
  const toolLines = server.tools.map(renderToolLine).join("\n");
  const lines = [
    `### ${server.package}`,
    "",
    server.description,
    "",
    `- Domain: ${server.domain}`,
    `- Status: ${server.status}`,
    `- Binary: \`${server.bin}\``,
    "",
    "Tools:",
    "",
    toolLines,
    ...renderEnvironmentSection(server),
  ];
  if (server.status !== "internal") {
    lines.push(
      "",
      "Configure in an MCP client. Pin the exact version; pass secrets as environment variable references, never literal values:",
      "",
      renderConsumerConfigSnippet(server),
    );
  }
  if (server.docs) {
    lines.push("", `Docs: ${server.docs}`);
  }
  return lines.join("\n");
}

function renderServersSection(manifest) {
  if (manifest.servers.length === 0) {
    return "_No servers are published yet._";
  }
  return manifest.servers.map(renderServerEntry).join("\n\n");
}

/** @param {{servers: unknown[]}} manifest */
export function renderGeneratedSection(manifest) {
  return [GLOSSARY, RELATED_REPOSITORIES, "## Servers", "", renderServersSection(manifest)].join("\n\n");
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
