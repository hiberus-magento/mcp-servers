// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. `templates/mcp.json` is the file a team copies into a project, so
// it is committed to that project's repository. What it may contain is
// therefore a safety property, not a style one: no credential, no switch that
// turns writes on, nothing that weakens TLS, and only variables the package
// actually reads.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface McpFile {
  readonly mcpServers: Record<string, { readonly command: string; readonly args: readonly string[]; readonly env?: Record<string, string> }>;
}

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const template = JSON.parse(read("../templates/mcp.json")) as McpFile;
const pkg = JSON.parse(read("../package.json")) as { name: string; bin: Record<string, string> };

// Every variable the package reads, so the template is a complete menu. `NODE_EXTRA_CA_CERTS` is Node's, not the
// package's, and is documented in the onboarding guide for local stores instead of being offered here.
const EVERY_VARIABLE = ["MAGENTO_REST_BASE_URL", "MAGENTO_REST_TOKEN", "MAGENTO_REST_ALLOW_WRITES", "MAGENTO_REST_FIELDS_FILE", "MAGENTO_REST_GROUPS", "MAGENTO_REST_DATABASE_CONNECTION", "MAGENTO_REST_DATABASE_PASSWORD", "MAGENTO_REST_DATABASE_ALLOW_WRITES"];

describe("templates/mcp.json", () => {
  const entries = Object.entries(template.mcpServers);
  const [name, server] = entries[0] ?? ["", undefined];
  const env = server?.env ?? {};

  it("declares exactly one server", () => {
    expect(entries).toHaveLength(1);
    expect(server).toBeDefined();
  });

  // The published package is started through npx, pinned to a version the user fills in (`<version>`), so the
  // project needs neither a checkout nor a node path.
  it("starts the published MCP server through npx, pinned to a version", () => {
    const mcpBin = Object.keys(pkg.bin).find((bin) => bin.endsWith("-mcp"));
    expect(server?.command).toBe("npx");
    expect(server?.args).toEqual(["-y", "--package", `${pkg.name}@<version>`, mcpBin]);
    expect(name.length).toBeGreaterThan(0);
  });

  it("lists every variable the package reads, and nothing else", () => {
    expect(Object.keys(env).sort()).toEqual([...EVERY_VARIABLE].sort());
  });

  it("is safe to commit and to copy as it is: no token, writes off, no extra fields, every group, no database, no database password, database writes off, an https store URL", () => {
    expect(env["MAGENTO_REST_TOKEN"]).toBe("");
    expect(env["MAGENTO_REST_ALLOW_WRITES"]).toBe("false");
    expect(env["MAGENTO_REST_FIELDS_FILE"]).toBe("");
    expect(env["MAGENTO_REST_GROUPS"]).toBe("");
    expect(env["MAGENTO_REST_DATABASE_CONNECTION"]).toBe("");
    expect(env["MAGENTO_REST_DATABASE_PASSWORD"]).toBe("");
    expect(env["MAGENTO_REST_DATABASE_ALLOW_WRITES"]).toBe("false");
    expect(new URL(env["MAGENTO_REST_BASE_URL"] ?? "").protocol).toBe("https:");
    expect(env["MAGENTO_REST_BASE_URL"]).toMatch(/\/rest\/V1$/);
  });

  it("never touches TLS verification", () => {
    expect(Object.keys(env).filter((key) => /TLS|REJECT/i.test(key))).toEqual([]);
  });
});
