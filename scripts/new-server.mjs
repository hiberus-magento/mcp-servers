#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `pnpm new-server <name>` (server-manifest spec, "pnpm new-server
// Generator"): scaffolds `packages/<name>` from `templates/server/`,
// registers it in `servers.json`, and regenerates README.md. Fails without
// writing anything if the package name already exists.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "./template-lib.mjs";
import { writeReadme } from "./gen-readme.mjs";

const DEFAULT_PACKAGES_DIR = fileURLToPath(new URL("../packages", import.meta.url));
const DEFAULT_MANIFEST_PATH = fileURLToPath(new URL("../servers.json", import.meta.url));
const DEFAULT_README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));

const TEMPLATE_TOOLS = [
  { name: "noop", readOnly: true, description: "A no-op tool used only to exercise the packaging gate." },
  {
    name: "read-echo",
    readOnly: true,
    description:
      "Echoes a message back through an allowlisted read-only subprocess call, proving stdout stays pure JSON-RPC even though a child process is spawned.",
  },
];

/**
 * @param {{
 *   name: string,
 *   domain: string,
 *   description: string,
 *   bin?: string,
 *   status?: "internal" | "planned" | "alpha" | "published",
 *   packagesDir?: string,
 *   serversJsonPath?: string,
 *   readmePath?: string,
 *   templateDir?: string,
 *   regenerateReadme?: boolean,
 * }} options
 * @returns {{ok: true, targetDir: string} | {ok: false, reason: string}}
 */
export function runNewServer(options) {
  const {
    name,
    domain,
    description,
    bin = name,
    status = "internal",
    packagesDir = DEFAULT_PACKAGES_DIR,
    serversJsonPath = DEFAULT_MANIFEST_PATH,
    readmePath = DEFAULT_README_PATH,
    templateDir,
    regenerateReadme = true,
  } = options;

  const targetDir = `${packagesDir}/${name}`;
  if (existsSync(targetDir)) {
    return { ok: false, reason: `packages/${name} already exists — refusing to overwrite it.` };
  }

  renderTemplate({ name, domain, bin, targetDir, ...(templateDir ? { templateDir } : {}) });

  const manifest = JSON.parse(readFileSync(serversJsonPath, "utf8"));
  manifest.servers.push({
    id: name,
    package: `@hiberus-magento/${name}`,
    bin,
    version: "0.0.0",
    domain,
    status,
    description,
    tools: TEMPLATE_TOOLS,
  });
  writeFileSync(serversJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (regenerateReadme) {
    writeReadme({ readmePath, manifestPath: serversJsonPath });
  }

  return { ok: true, targetDir };
}

function parseCliArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--domain") {
      options.domain = value;
      i += 1;
    } else if (flag === "--description") {
      options.description = value;
      i += 1;
    } else if (flag === "--bin") {
      options.bin = value;
      i += 1;
    }
  }
  return options;
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.name) {
    console.error("Usage: pnpm new-server <name> --domain <domain> [--description <text>] [--bin <bin>]");
    process.exitCode = 1;
    return;
  }
  const result = runNewServer({
    name: parsed.name,
    domain: parsed.domain ?? parsed.name,
    description: parsed.description ?? `The ${parsed.name} MCP server.`,
    bin: parsed.bin,
  });
  if (!result.ok) {
    console.error(`new-server: FAIL — ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.error(`new-server: created ${result.targetDir}, registered in servers.json, README.md regenerated.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
