#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Generates the `<!-- servers:start -->`/`<!-- servers:end -->` section of
// README.md from `servers.json` (server-manifest spec, "Generated README,
// No Hand Edits"). `--check` re-runs this exact code path in memory and
// diffs the result against the committed file — a single implementation,
// so the staleness check cannot drift from the generator (design.md,
// Decision 6).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- servers:start -->";
const END_MARKER = "<!-- servers:end -->";

/**
 * The exact phrase a tool carrying `unverified` is marked with, in README.md
 * and in the tool's own shipped description alike. Exported so the drift test
 * that keeps those two in step has one spelling to check rather than its own
 * copy of the wording.
 */
export const UNVERIFIED_MARKER = "Not verified against a live service";

const DEFAULT_README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL("../servers.json", import.meta.url));

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
function renderConsumerConfigSnippet(server) {
  const env = Object.fromEntries(
    (server.requires?.env ?? []).filter((entry) => entry.required).map((entry) => [entry.name, `\${${entry.name}}`]),
  );
  const snippet = {
    mcpServers: {
      [server.bin]: {
        command: "npx",
        args: ["-y", `${server.package}@${server.version}`],
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
 * @param {string} currentReadme
 * @param {{servers: unknown[]}} manifest
 */
export function renderFullReadme(currentReadme, manifest) {
  const startIndex = currentReadme.indexOf(START_MARKER);
  const endIndex = currentReadme.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md is missing the ${START_MARKER} / ${END_MARKER} markers`);
  }
  const before = currentReadme.slice(0, startIndex + START_MARKER.length);
  const after = currentReadme.slice(endIndex);
  const generated = renderGeneratedSection(manifest);
  return `${before}\n\n${generated}\n\n${after}`;
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

async function main() {
  const check = process.argv.includes("--check");
  if (check) {
    const result = checkReadme();
    if (result.stale) {
      console.error("gen-readme --check: README.md is stale relative to servers.json.");
      console.error("Run `node scripts/gen-readme.mjs` to regenerate it.");
      process.exitCode = 1;
      return;
    }
    console.error("gen-readme --check: README.md is up to date.");
    return;
  }
  writeReadme();
  console.error("gen-readme: README.md regenerated from servers.json.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
